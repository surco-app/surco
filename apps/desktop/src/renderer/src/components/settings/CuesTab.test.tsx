// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../../preload/api'
import { ALL_TRACKS_ID } from '../../../../shared/allTracks'
import {
  BUNDLED_FLOWS,
  CALLS_ONLY,
  type CueFlow,
  MIX_IN,
  MIX_IN_32,
  MY_FLOW,
  ONE_AT_32,
} from '../../../../shared/cueFlows'
import type { CueGridTolerance } from '../../../../shared/cueGrid'
import type { CueJumpBars } from '../../../../shared/cueJump'
import type { CueQuantize } from '../../../../shared/cueQuantize'
import type { SourcePlaylistEntry, TrackCues } from '../../../../shared/types'
import i18n from '../../i18n'
import {
  EXAMPLE_DROP,
  EXAMPLE_DURATION_MS,
  EXAMPLE_GRID,
  exampleBar,
  flowFromTrack,
} from '../../lib/cueExample'
import { createQueryClient } from '../../lib/queryClient'
import type { SyncedDraft } from '../../lib/settingsDraft'
import { djReads, installApi, type ProgramReads } from '../../test/api'
import { hoverTooltip } from '../../test/tooltip'
import { CuesTab } from './CuesTab'

let afterTest: (() => unknown) | null = null

afterEach(async () => {
  cleanup()
  await afterTest?.()
  afterTest = null
})

let last: Pick<
  SyncedDraft,
  | 'cueFlows'
  | 'activeCueFlow'
  | 'cueJumpBars'
  | 'cueQuantize'
  | 'cueGridTolerance'
  | 'cueLettersByTime'
  | 'cueFlowToRekordbox'
  | 'cueFlowToTraktor'
  | 'cueFlowToEngine'
  | 'cueFlowToSerato'
  | 'cueFlowToVirtualdj'
> | null = null

const KEPT: CueFlow[] = [MIX_IN, MY_FLOW, ONE_AT_32, CALLS_ONLY]

const LEARNED = {
  learnedAt: '2026-10-28T10:00:00.000Z',
  sources: { rekordbox: 40, edits: 0 },
  taste: null,
  check: null,
  flow: { id: 'learned', name: '', markPoint: true, rules: ONE_AT_32.rules },
  coverage: { matching: 30, marked: 40 },
  paired: 1,
  start: null,
}

function Harness({
  active = 'mine',
  collection = '',
  flows = KEPT,
  queries,
}: {
  active?: string
  collection?: string
  flows?: CueFlow[]
  queries?: QueryClient
}) {
  const [draft, setDraft] = useState({
    cueFlows: flows,
    activeCueFlow: active,
    cueJumpBars: 16 as CueJumpBars,
    cueQuantize: 'bar' as CueQuantize,
    cueGridTolerance: 10 as CueGridTolerance,
    cueLettersByTime: true,
    cueFlowToRekordbox: true,
    cueFlowToTraktor: true,
    cueFlowToEngine: true,
    cueFlowToSerato: true,
    cueFlowToVirtualdj: true,
    cueLearnFromEdits: true,
  })
  const [client] = useState(() => queries ?? new QueryClient())
  last = draft
  return (
    <QueryClientProvider client={client}>
      <CuesTab
        synced={draft as unknown as SyncedDraft}
        patch={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
        rekordboxCollection={collection}
      />
    </QueryClientProvider>
  )
}

const inCollection = (
  contentId: string,
  title: string,
  cues: { ms: number; kind: number }[] = [{ ms: 64000, kind: 0 }],
): SourcePlaylistEntry => ({
  path: `/music/${contentId}.aiff`,
  separator: false,
  meta: {},
  contentId,
  preview: {
    title,
    artist: '',
    durationSec: 0,
    cues: cues.map((c) => ({ ...c, color: null })),
  },
})
const collectionOf = (...entries: SourcePlaylistEntry[]) =>
  djReads({ rekordbox: { playlist: async () => entries } })
const glueCollection = () => collectionOf(inCollection('rb:7', 'Bicep, Glue'))
const MARKED_BY_HAND: TrackCues = {
  contentId: 'rb:7',
  analysed: true,
  grid: EXAMPLE_GRID,
  strong: [{ start: exampleBar(97), end: exampleBar(129) }],
  phrases: [{ ms: exampleBar(97), kind: 'chorus' }],
  cues: [
    { id: 'mark', ms: exampleBar(97), kind: 0, color: null },
    { id: 'a', ms: exampleBar(81), kind: 1, color: 22 },
    { id: 'b', ms: exampleBar(65), kind: 2, color: 1 },
  ],
  wave: null,
  durationMs: EXAMPLE_DURATION_MS,
  fingerprint: '',
  gridFingerprint: '',
}
const previewGlue = async () => {
  fireEvent.click(screen.getByTestId('cue-preview-track'))
  fireEvent.click(await screen.findByTestId('cue-preview-track-option-rb:7'))
  await waitFor(() =>
    expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Bicep, Glue'),
  )
}

const openPicker = () => fireEvent.click(screen.getByTestId('cue-flow-picker'))
const openAdd = () => fireEvent.click(screen.getByTestId('cue-flow-add'))
const openMore = () => fireEvent.click(screen.getByTestId('cue-flow-more'))
const pick = (id: string) => {
  openPicker()
  fireEvent.click(screen.getByTestId(`cue-flow-${id}`))
}
const startRename = () => {
  openMore()
  fireEvent.click(screen.getByTestId('cue-flow-rename'))
}

describe('CuesTab', () => {
  // The rules are shared by every library, and two of their parts only fully reach
  // rekordbox: CALLs (only rekordbox has them) and colours (Traktor paints by cue type).
  it('previews the flow on the track selected in the list, read from its library', async () => {
    installApi({
      cues: {
        trackCues: async () => ({
          contentId: 'rb:1',
          analysed: true,
          grid: Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 })),
          strong: [],
          phrases: [],
          cues: [{ id: 'mark', ms: 128000, kind: 0, color: null }],
          wave: null,
          durationMs: 400000,
          fingerprint: 'f',
          gridFingerprint: 'g',
        }),
      },
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CuesTab
          synced={{ cueFlows: KEPT, activeCueFlow: 'mine' } as unknown as SyncedDraft}
          patch={() => {}}
          rekordboxCollection=""
          cueTrack={{ contentId: 'rb:1', label: 'DJ Made, Millenium Stringz' }}
        />
      </QueryClientProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('cue-preview-track')).toHaveTextContent(
        'DJ Made, Millenium Stringz',
      ),
    )
  })

  it('previews the flow on another track of the collection once it is picked, read from its library', async () => {
    const trackCues = vi.fn(async (contentId: string) => ({
      contentId,
      analysed: true,
      grid: Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 })),
      strong: [],
      phrases: [],
      cues: [{ id: 'mark', ms: 128000, kind: 0, color: null }],
      wave: null,
      durationMs: 400000,
      fingerprint: 'f',
      gridFingerprint: 'g',
    }))
    installApi({ cues: { trackCues }, dj: glueCollection() })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CuesTab
          synced={{ cueFlows: KEPT, activeCueFlow: 'mine' } as unknown as SyncedDraft}
          patch={() => {}}
          rekordboxCollection="/rb/master.db"
        />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Example track')
    expect(trackCues).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('cue-preview-track'))
    fireEvent.click(await screen.findByTestId('cue-preview-track-option-rb:7'))
    await waitFor(() =>
      expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Bicep, Glue'),
    )
    expect(trackCues).toHaveBeenCalledWith('rb:7')
  })

  it('says on the row of each program what reaches it, Traktor in blue and the others the hot cues only, and that it is missing where it is not installed', async () => {
    installApi({
      dj: djReads({
        traktor: { available: async () => true },
        engine: { available: async () => false },
        serato: { available: vi.fn<ProgramReads['available']>(async () => true) },
      }),
    })
    render(<Harness collection="/c/master.db" />)
    await waitFor(() => expect(screen.getByTestId('settings-cue-flow-to-traktor')).toBeEnabled())
    expect(screen.getByTestId('settings-cue-flow-to-rekordbox-gets')).toHaveTextContent(
      /^Hot cues and CALLs$/,
    )
    expect(screen.getByTestId('settings-cue-flow-to-traktor-gets')).toHaveTextContent(
      /^Hot cues only, in blue, from A to G$/,
    )
    expect(screen.getByTestId('settings-cue-flow-to-serato-gets')).toHaveTextContent(
      /^Hot cues only, from A to H$/,
    )
    expect(await screen.findByTestId('settings-cue-flow-to-engine-missing')).toHaveTextContent(
      /^No Engine DJ library was found$/,
    )
    expect(screen.queryByTestId('settings-cue-flow-to-engine-gets')).toBeNull()
    expect(screen.queryByTestId('cue-flow-library-note')).not.toBeInTheDocument()
    cleanup()
    installApi({
      dj: djReads({
        traktor: { available: async () => false },
        engine: { available: async () => true },
      }),
    })
    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId('settings-cue-flow-to-engine')).toBeEnabled())
    expect(screen.getByTestId('settings-cue-flow-to-engine-gets')).toHaveTextContent(
      /^Hot cues only$/,
    )
    expect(screen.getByTestId('settings-cue-flow-to-traktor-missing')).toHaveTextContent(
      /^No Traktor collection was found$/,
    )
    expect(screen.queryByTestId('settings-cue-flow-to-traktor-gets')).toBeNull()
    expect(screen.queryByTestId('cue-flow-library-note')).not.toBeInTheDocument()
  })

  it('says on Windows too what each found program gets on its own row, with no note under the list', async () => {
    installApi({
      platform: 'win32',
      dj: djReads({ engine: { available: async () => true } }),
    })
    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId('settings-cue-flow-to-engine')).toBeEnabled())
    expect(screen.getByTestId('settings-cue-flow-to-engine-gets')).toHaveTextContent(
      /^Hot cues only$/,
    )
    expect(screen.queryByTestId('cue-flow-library-note')).not.toBeInTheDocument()
  })

  it('has a VirtualDJ destination on Windows too, where Surco offers VirtualDJ in beta', async () => {
    installApi({ platform: 'win32' })
    render(<Harness />)
    expect(await screen.findByTestId('settings-cue-flow-to-serato')).toBeInTheDocument()
    expect(screen.getByTestId('settings-cue-flow-to-virtualdj')).toBeInTheDocument()
  })

  it('says on their rows that rekordbox gets the CALLs and VirtualDJ the hot cues only when only those two are found, since a flow reaches VirtualDJ without its CALLs', async () => {
    installApi({ dj: djReads({ virtualdj: { available: async () => true } }) })
    render(<Harness collection="/c/master.db" />)
    await waitFor(() => expect(screen.getByTestId('settings-cue-flow-to-virtualdj')).toBeEnabled())
    expect(screen.getByTestId('settings-cue-flow-to-virtualdj-gets')).toHaveTextContent(
      /^Hot cues only, from A to H$/,
    )
    expect(screen.getByTestId('settings-cue-flow-to-rekordbox-gets')).toHaveTextContent(
      /^Hot cues and CALLs$/,
    )
    expect(screen.queryByTestId('cue-flow-library-note')).not.toBeInTheDocument()
  })

  it('shows a destination as missing only for the programs that are not installed', async () => {
    installApi({
      dj: djReads({
        traktor: { available: async () => false },
        engine: { available: async () => true },
        serato: { available: async () => true },
      }),
    })
    render(<Harness />)
    await waitFor(() => {
      expect(screen.queryByTestId('settings-cue-flow-to-engine-missing')).not.toBeInTheDocument()
      expect(screen.queryByTestId('settings-cue-flow-to-serato-missing')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('settings-cue-flow-to-traktor-missing')).toBeInTheDocument()
    cleanup()
    installApi({
      dj: djReads({
        traktor: { available: async () => true },
        engine: { available: async () => false },
        serato: { available: async () => false },
      }),
    })
    render(<Harness />)
    expect(await screen.findByTestId('settings-cue-flow-to-engine-missing')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByTestId('settings-cue-flow-to-traktor-missing')).not.toBeInTheDocument()
      expect(screen.getByTestId('settings-cue-flow-to-serato-missing')).toBeInTheDocument()
    })
  })

  it('says a destination is missing in the same words as the sidebar list in General, so one program is not missing in two ways', async () => {
    installApi({ dj: djReads({ serato: { available: async () => false } }) })
    render(<Harness />)
    expect(await screen.findByTestId('settings-cue-flow-to-serato-missing')).toHaveTextContent(
      i18n.t('settings.sourceSeratoUnavailable'),
    )
  })

  it('lets the DJ send the flows to a found VirtualDJ and says it gets the hot cues only, saved when VirtualDJ closes', async () => {
    installApi({ dj: djReads({ virtualdj: { available: async () => true } }) })
    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId('settings-cue-flow-to-virtualdj')).toBeEnabled())
    expect(screen.getByTestId('settings-cue-flow-to-virtualdj')).toBeChecked()
    expect(screen.getByTestId('settings-cue-flow-to-virtualdj-gets')).toHaveTextContent(
      /^Hot cues only, from A to H$/,
    )
    expect(screen.getByTestId('settings-cue-flow-to-virtualdj-caveat')).toHaveTextContent(
      /^If VirtualDJ is open, Surco saves them when you close it$/,
    )
    fireEvent.click(screen.getByTestId('settings-cue-flow-to-virtualdj'))
    expect(last?.cueFlowToVirtualdj).toBe(false)
    expect(last?.cueFlowToSerato).toBe(true)
  })

  it('says a destination is missing once its probe fails, since a failed probe is an answer and the neutral hint would wait forever', async () => {
    installApi({
      dj: djReads({
        traktor: {
          available: async () => {
            throw new Error('library unreadable')
          },
        },
      }),
    })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <CuesTab
          synced={{ cueFlows: KEPT, activeCueFlow: 'mine' } as unknown as SyncedDraft}
          patch={() => {}}
          rekordboxCollection=""
        />
      </QueryClientProvider>,
    )
    expect(await screen.findByTestId('settings-cue-flow-to-traktor-missing')).toBeInTheDocument()
  })

  it('probes the destinations again each time the tab opens, so a library saved in Settings shows as found', async () => {
    const traktor = vi.fn<ProgramReads['available']>(async () => false)
    installApi({ dj: djReads({ traktor: { available: traktor } }) })
    const client = new QueryClient()
    const tab = () => (
      <QueryClientProvider client={client}>
        <CuesTab
          synced={{ cueFlows: KEPT, activeCueFlow: 'mine' } as unknown as SyncedDraft}
          patch={() => {}}
          rekordboxCollection=""
        />
      </QueryClientProvider>
    )
    const first = render(tab())
    expect(await screen.findByTestId('settings-cue-flow-to-traktor-missing')).toBeInTheDocument()
    first.unmount()
    traktor.mockImplementation(async () => true)
    render(tab())
    await waitFor(() =>
      expect(screen.queryByTestId('settings-cue-flow-to-traktor-missing')).not.toBeInTheDocument(),
    )
  })

  it('marks the point with a CALL by default and lets a DJ who does not mark it turn that off, the preview following', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-flow-mark-point')).toBeChecked()
    expect(screen.getByTestId(`cue-wave-call-${EXAMPLE_DROP}`)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-flow-mark-point'))
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.markPoint).toBe(false)
    expect(screen.getByTestId('cue-flow-mark-point')).not.toBeChecked()
    expect(screen.queryByTestId(`cue-wave-call-${EXAMPLE_DROP}`)).toBeNull()
  })

  it('marks no flow as the default while the editor is in Manual, and Poner por defecto leaves Manual', () => {
    render(<Harness active="manual" />)
    openPicker()
    expect(screen.queryByTestId('cue-flow-in-use')).toBeNull()
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-use'))
    expect(last?.activeCueFlow).toBe('mine')
  })

  it('letters the hot cues in track order by default and lets a DJ with fixed pads turn it off', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    const toggle = screen.getByTestId('settings-cue-letters-by-time')
    expect(toggle).toBeChecked()
    expect(screen.getByText('Letras en orden de la pista')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(last?.cueLettersByTime).toBe(false)
  })

  it('keeps why the letters follow the track behind an (i) beside the box, so the last row of the manual editor is one line like the rest', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    const why =
      'La A siempre es el primer cue de la pista. Apágalo si cada letra es un pad fijo para ti.'
    const row = screen.getByTestId('cue-letters')
    expect(screen.getByTestId('cue-manual').lastElementChild).toBe(row)
    const info = within(row).getByTestId('settings-cue-letters-hint')
    expect(info.tagName).toBe('BUTTON')
    expect(info).toHaveClass('press')
    expect(info).not.toHaveAttribute('title')
    expect(info).toHaveAccessibleName(why)
    expect(info.closest('label')).toBeNull()
    expect(row.querySelectorAll('p')).toHaveLength(0)
    expect(hoverTooltip(info)).toBe(why)
  })

  it('gives a new DJ the two bundled flows, Mix in 64 marked as the default', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness flows={BUNDLED_FLOWS} active="mix-in" />)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Mix in 64')
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Por defecto')
    openPicker()
    expect(screen.getByTestId('cue-flow-mix-in-32')).toHaveTextContent('Mix in 32')
    expect(screen.queryByTestId('cue-flow-mine')).toBeNull()
    expect(screen.queryByTestId('cue-flow-calls-only')).toBeNull()
    expect(screen.getByTestId('cue-flow-mix-in')).toHaveTextContent('Por defecto')
    expect(screen.getByTestId('cue-flow-mix-in')).toHaveAttribute('aria-checked', 'true')
  })

  it('cuts a long flow name with an ellipsis inside the list button, so the row never grows wider than Settings nor pushes + and the actions away', () => {
    const long = 'Warm up for the long sets at the club on Sundays'
    render(<Harness flows={[MIX_IN, { ...MY_FLOW, name: long }]} />)
    const picker = screen.getByTestId('cue-flow-picker')
    expect(picker).toHaveClass('w-full', 'min-w-0')
    expect(picker.parentElement).toHaveClass('min-w-0', 'flex-1')
    expect(within(picker).getByText(long)).toHaveClass('min-w-0', 'flex-1', 'truncate')
    expect(screen.getByTestId('cue-flow-add')).toHaveClass('shrink-0')
    expect(screen.getByTestId('cue-flow-more')).toHaveClass('shrink-0')
    openPicker()
    expect(within(screen.getByTestId('cue-flow-mine')).getByText(long)).toHaveClass(
      'min-w-0',
      'truncate',
    )
  })

  it('renames the flow where the list of flows was, + and the actions keeping their place', () => {
    render(<Harness />)
    startRename()
    expect(screen.queryByTestId('cue-flow-picker')).toBeNull()
    expect(screen.getByTestId('cue-flow-name')).toHaveClass('min-w-0', 'flex-1')
    fireEvent.blur(screen.getByTestId('cue-flow-name'))
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('My flow')
  })

  // Every flow menu hangs below its button's right edge, so it has to scale out of that
  // corner; growing from its centre makes it look detached from the button that opened it.
  it('grows the flow menus out of the corner that touches their button', () => {
    render(<Harness />)
    openMore()
    expect(screen.getByRole('menu')).toHaveClass('origin-top-right')
  })

  it('keeps Poner por defecto with the actions on the open flow, out of the list of flows to pick', () => {
    render(<Harness />)
    pick('one-at-32')
    openPicker()
    expect(within(screen.getByRole('menu')).queryByTestId('cue-flow-use')).toBeNull()
  })

  it('offers Poner por defecto on a flow that is not the default', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    pick('one-at-32')
    openMore()
    expect(screen.getByTestId('cue-flow-use')).toHaveTextContent('Poner por defecto')
    fireEvent.click(screen.getByTestId('cue-flow-use'))
    expect(last?.activeCueFlow).toBe('one-at-32')
  })

  it('lists the flows an earlier Surco kept with their names, the default marked', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    openPicker()
    expect(screen.getByTestId('cue-flow-mine')).toHaveTextContent('Mi flujo')
    expect(screen.getByTestId('cue-flow-mine')).toHaveTextContent('Por defecto')
    expect(screen.getByTestId('cue-flow-one-at-32')).toHaveTextContent('Un cue a 32')
    expect(screen.getByTestId('cue-flow-calls-only')).toHaveTextContent('Solo CALL')
  })

  it('marks the bundled flow as the default when the stored active flow no longer exists, since that is the flow that runs', () => {
    render(<Harness flows={BUNDLED_FLOWS} active="gone" />)
    openPicker()
    expect(
      within(screen.getByTestId('cue-flow-mix-in')).getByTestId('cue-flow-in-use'),
    ).toBeInTheDocument()
    openMore()
    expect(screen.getByTestId('cue-flow-use')).toBeDisabled()
  })

  it('keeps marking the Mi flujo an earlier Surco kept when the stored active flow no longer exists, as main still runs it', () => {
    render(<Harness active="gone" />)
    openPicker()
    expect(
      within(screen.getByTestId('cue-flow-mine')).getByTestId('cue-flow-in-use'),
    ).toBeInTheDocument()
    openMore()
    expect(screen.getByTestId('cue-flow-use')).toBeDisabled()
  })

  it('recalculates the preview live when a block changes', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-0-repeat'))
    fireEvent.click(screen.getByTestId('cue-rule-0-repeat-option-1'))
    expect(screen.queryByTestId('cue-wave-hot-C')).toBeNull()
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.rules[0].repeat).toBe(1)
    expect(screen.queryByTestId('cue-rule-0-repeat-menu')).toBeNull()
  })

  it('adds and removes a rule', () => {
    render(<Harness />)
    pick('calls-only')
    expect(screen.getByTestId('cue-flow-no-rules')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-add'))
    expect(screen.getByTestId('cue-rule-0')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-0-remove'))
    expect(screen.getByTestId('cue-flow-no-rules')).toBeInTheDocument()
  })

  it('closes an open colour popover when a rule is removed so it never lands on another rule', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-palette')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-0-remove'))
    expect(screen.queryByTestId('cue-palette')).toBeNull()
  })

  it('opens rekordbox picker with Restablecer from a rule colour', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-palette-reset')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-palette-reset'))
    expect(screen.queryByTestId('cue-palette')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-palette-22')).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens a rule colour picker towards the left when Settings would cut its right side, so every colour and Restablecer stay reachable', () => {
    const rect = (left: number, width: number) =>
      ({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 0,
        height: 0,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    let scrollerRight = 1093
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('data-testid') === 'scroller') return rect(0, scrollerRight)
      if (this.getAttribute('data-testid') === 'cue-rule-1-color-0-palette') return rect(0, 114)
      return rect(1008, 18)
    })
    afterTest = () => spy.mockRestore()
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
        <Harness />
      </div>,
    )
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-rule-1-color-0-palette')).toHaveAttribute('data-align', 'right')
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    scrollerRight = 1400
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-rule-1-color-0-palette')).toHaveAttribute('data-align', 'left')
  })

  it('opens the condition list towards the left when Settings would cut its right side, so every explanation can be read', () => {
    const rect = (left: number, width: number) =>
      ({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 0,
        height: 0,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('data-testid') === 'scroller') return rect(0, 1093)
      if (this.getAttribute('data-testid') === 'cue-rule-0-when-menu') return rect(0, 288)
      return rect(900, 40)
    })
    afterTest = () => spy.mockRestore()
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
        <Harness />
      </div>,
    )
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(screen.getByTestId('cue-rule-0-when-menu')).toHaveAttribute('data-align', 'right')
  })

  it('opens the condition list upwards when Settings would cut its bottom, so the last options stay reachable', () => {
    const box = (top: number, height: number, left = 0, width = 300) =>
      ({
        left,
        right: left + width,
        width,
        top,
        bottom: top + height,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect
    let scrollerBottom = 700
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('data-testid') === 'scroller') return box(0, scrollerBottom, 0, 1093)
      if (this.getAttribute('data-testid') === 'cue-rule-0-when-menu') return box(0, 300)
      return box(500, 24, 100, 40)
    })
    afterTest = () => spy.mockRestore()
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
        <Harness />
      </div>,
    )
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(screen.getByTestId('cue-rule-0-when-menu')).toHaveAttribute('data-side', 'top')
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    scrollerBottom = 1200
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(screen.getByTestId('cue-rule-0-when-menu')).toHaveAttribute('data-side', 'bottom')
  })

  it('opens a rule colour picker upwards when Settings would cut its bottom, so the conditions under the colours stay reachable', () => {
    const box = (top: number, height: number, left = 0, width = 300) =>
      ({
        left,
        right: left + width,
        width,
        top,
        bottom: top + height,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect
    let scrollerBottom = 700
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('data-testid') === 'scroller') return box(0, scrollerBottom, 0, 1093)
      if (this.getAttribute('data-testid') === 'cue-rule-0-color-0-palette') return box(0, 300)
      return box(500, 20, 100, 20)
    })
    afterTest = () => spy.mockRestore()
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
        <Harness />
      </div>,
    )
    fireEvent.click(screen.getByTestId('cue-rule-0-color-0'))
    expect(screen.getByTestId('cue-rule-0-color-0-palette')).toHaveAttribute('data-side', 'top')
    fireEvent.click(screen.getByTestId('cue-rule-0-color-0'))
    scrollerBottom = 1200
    fireEvent.click(screen.getByTestId('cue-rule-0-color-0'))
    expect(screen.getByTestId('cue-rule-0-color-0-palette')).toHaveAttribute('data-side', 'bottom')
  })

  it('scrolls a rule colour picker into view when it fits neither under nor over its square, so a rule at the top of Settings still shows every condition', () => {
    const box = (top: number, height: number, left = 0, width = 300) =>
      ({
        left,
        right: left + width,
        width,
        top,
        bottom: top + height,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('data-testid') === 'scroller') return box(0, 700, 0, 1093)
      if (this.getAttribute('data-testid') === 'cue-rule-0-color-0-palette') return box(0, 300)
      return box(500, 20, 100, 20)
    })
    afterTest = () => spy.mockRestore()
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
        <Harness />
      </div>,
    )
    fireEvent.click(screen.getByTestId('cue-rule-0-color-0'))
    expect(screen.getByTestId('scroller').scrollTop).toBe(0)
    fireEvent.click(screen.getByTestId('cue-rule-0-color-0'))
    spy.mockImplementation(function (this: Element) {
      if (this.getAttribute('data-testid') === 'scroller') return box(0, 700, 0, 1093)
      if (this.getAttribute('data-testid') === 'cue-rule-0-color-0-palette') return box(0, 480)
      return box(300, 20, 100, 20)
    })
    fireEvent.click(screen.getByTestId('cue-rule-0-color-0'))
    expect(screen.getByTestId('scroller').scrollTop).toBe(104)
  })

  it('places a rule colour picker by its full size and the gap to its square, not by the size it has while it pops in, so its last condition is never cut by a few pixels', () => {
    const box = (top: number, height: number, left = 0, width = 300) =>
      ({
        left,
        right: left + width,
        width,
        top,
        bottom: top + height,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('data-testid') === 'scroller') return box(0, 720, 0, 1093)
      if (this.getAttribute('data-testid') === 'cue-rule-0-color-0-palette') return box(0, 299)
      return box(396, 20, 100, 20)
    })
    const full = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.getAttribute('data-testid') === 'cue-rule-0-color-0-palette' ? 305 : 0
      })
    afterTest = () => {
      spy.mockRestore()
      full.mockRestore()
    }
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
        <Harness />
      </div>,
    )
    fireEvent.click(screen.getByTestId('cue-rule-0-color-0'))
    expect(screen.getByTestId('cue-rule-0-color-0-palette')).toHaveAttribute('data-side', 'top')
  })

  it('counts the scrollbar of Settings as outside when placing a rule colour picker, so its right edge never slides under it', () => {
    const rect = (left: number, width: number) =>
      ({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 0,
        height: 0,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('data-testid') === 'scroller') return rect(0, 1093)
      if (this.getAttribute('data-testid') === 'cue-rule-1-color-0-palette') return rect(0, 183)
      return rect(905, 20)
    })
    afterTest = () => spy.mockRestore()
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
        <Harness />
      </div>,
    )
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-rule-1-color-0-palette')).toHaveAttribute('data-align', 'left')
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    Object.defineProperty(screen.getByTestId('scroller'), 'clientWidth', { value: 1084 })
    fireEvent.click(screen.getByTestId('cue-rule-1-color-0'))
    expect(screen.getByTestId('cue-rule-1-color-0-palette')).toHaveAttribute('data-align', 'right')
  })

  it('gives the focus back to the token when its list closes, so Escape closes the list first and Settings only after', () => {
    const settingsEscape = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', settingsEscape)
    afterTest = () => window.removeEventListener('keydown', settingsEscape)
    render(<Harness />)
    const token = screen.getByTestId('cue-rule-0-bars')
    fireEvent.click(token)
    screen.getByTestId('cue-rule-0-bars-option-8').focus()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByTestId('cue-rule-0-bars-menu')).toBeNull()
    expect(settingsEscape).not.toHaveBeenCalled()
    expect(token).toHaveFocus()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(settingsEscape).toHaveBeenCalledTimes(1)
    fireEvent.click(token)
    const option = screen.getByTestId('cue-rule-0-bars-option-8')
    option.focus()
    fireEvent.click(option)
    expect(screen.getByTestId('cue-rule-0-bars')).toHaveFocus()
  })

  it('hides direction and repeat for a cue on the origin itself', () => {
    render(<Harness />)
    expect(screen.queryByTestId('cue-rule-1-direction')).toBeNull()
    expect(screen.queryByTestId('cue-rule-1-repeat')).toBeNull()
  })

  it('warns that a loose CALL from a rule reads as a drop next time', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-rule-0-place'))
    fireEvent.click(screen.getByTestId('cue-rule-0-place-option-call'))
    expect(screen.getByTestId('cue-rule-0-loose-call')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-rule-0-color-mode')).toBeNull()
  })

  it('creates a flow straight into naming it, the way a new folder opens in Finder, and makes it the one in use', () => {
    render(<Harness />)
    openAdd()
    expect(screen.getByTestId('cue-flow-name')).toHaveFocus()
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Mis 64' } })
    fireEvent.keyDown(screen.getByTestId('cue-flow-name'), { key: 'Enter' })
    expect(screen.queryByTestId('cue-flow-name')).toBeNull()
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Mis 64')
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-use'))
    const made = last?.cueFlows.find((f) => f.name === 'Mis 64')
    expect(made).toBeDefined()
    expect(last?.activeCueFlow).toBe(made?.id)
  })

  it('renames Mi flujo and a user flow from Cambiar nombre, the input showing what was typed', () => {
    render(<Harness />)
    startRename()
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Mi set' } })
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.name).toBe('Mi set')
    expect(screen.getByTestId('cue-flow-name')).toHaveValue('Mi set')
    fireEvent.blur(screen.getByTestId('cue-flow-name'))
    openAdd()
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Otro' } })
    expect(screen.getByTestId('cue-flow-name')).toHaveValue('Otro')
    expect(last?.cueFlows.at(-1)?.name).toBe('Otro')
  })

  it('lets the DJ edit the name Mi flujo shows instead of an unselectable placeholder, and an emptied name falls back', () => {
    render(<Harness />)
    startRename()
    const input = screen.getByTestId('cue-flow-name')
    expect(input).toHaveValue('My flow')
    fireEvent.change(input, { target: { value: 'Mi flujo 2' } })
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.name).toBe('Mi flujo 2')
    fireEvent.change(input, { target: { value: '' } })
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.name).toBe('')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', 'My flow')
    fireEvent.blur(input)
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('My flow')
  })

  it('restores the name of the bundled flow with Restablecer', () => {
    render(<Harness flows={BUNDLED_FLOWS} active="mix-in" />)
    startRename()
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Otro' } })
    fireEvent.blur(screen.getByTestId('cue-flow-name'))
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-restore'))
    expect(last?.cueFlows.find((f) => f.id === 'mix-in')?.name).toBe('')
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Mix in 64')
  })

  it('ends a rename on Escape without closing Settings, keeping what was typed', () => {
    const settingsEscape = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', settingsEscape)
    afterTest = () => window.removeEventListener('keydown', settingsEscape)
    render(<Harness />)
    startRename()
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Mi set' } })
    fireEvent.keyDown(screen.getByTestId('cue-flow-name'), { key: 'Escape' })
    expect(settingsEscape).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cue-flow-name')).toBeNull()
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Mi set')
  })

  it('never offers to delete a bundled flow but restores it as Surco ships it', () => {
    render(<Harness flows={BUNDLED_FLOWS} active="mix-in" />)
    openMore()
    expect(screen.queryByTestId('cue-flow-delete')).toBeNull()
    openMore()
    fireEvent.click(screen.getByTestId('cue-rule-0-bars'))
    fireEvent.click(screen.getByTestId('cue-rule-0-bars-option-8'))
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-restore'))
    expect(last?.cueFlows).toEqual([MIX_IN, MIX_IN_32])
    pick('mix-in-32')
    openMore()
    expect(screen.queryByTestId('cue-flow-delete')).toBeNull()
    openMore()
    fireEvent.click(screen.getByTestId('cue-rule-0-bars'))
    fireEvent.click(screen.getByTestId('cue-rule-0-bars-option-4'))
    expect(last?.cueFlows[1].rules[0].bars).toBe(4)
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-restore'))
    expect(last?.cueFlows).toEqual([MIX_IN, MIX_IN_32])
  })

  it('treats the Mi flujo an earlier Surco kept as a flow of the DJ, deletable and with nothing to restore', () => {
    render(<Harness />)
    openMore()
    expect(screen.queryByTestId('cue-flow-restore')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-flow-delete'))
    expect(last?.cueFlows.map((f) => f.id)).toEqual(['mix-in', 'one-at-32', 'calls-only'])
    expect(last?.activeCueFlow).toBe('mix-in')
    openPicker()
    expect(screen.getByTestId('cue-flow-mix-in')).toHaveAttribute('aria-checked', 'true')
  })

  it('deletes another flow and falls back to the bundled flow when it was the default', () => {
    render(<Harness active="calls-only" />)
    pick('calls-only')
    openMore()
    fireEvent.click(screen.getByTestId('cue-flow-delete'))
    expect(last?.cueFlows.map((f) => f.id)).toEqual(['mix-in', 'mine', 'one-at-32'])
    expect(last?.activeCueFlow).toBe('mix-in')
  })

  it('reads each rule as one sentence, the way the DJ would say it', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    expect(screen.getByTestId('cue-rule-0')).toHaveTextContent(
      'Desde donde marcas, hacia atrás, cada 16 compases, 3 veces, si cabe, pon hot cue + CALL',
    )
    expect(screen.getByTestId('cue-rule-1')).toHaveTextContent(
      'Desde el primer golpe de la pista, en el mismo golpe, si no hay otro antes de donde marcas, pon hot cue + CALL',
    )
  })

  it('opens one block list at a time and closes it with Escape or a click elsewhere', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(screen.getByTestId('cue-rule-0-when-option-always')).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByTestId('cue-rule-0-when-option-fits')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(screen.getByTestId('cue-rule-0-bars'))
    expect(screen.queryByTestId('cue-rule-0-when-menu')).toBeNull()
    fireEvent.keyDown(screen.getByTestId('cue-rule-0-bars-menu'), { key: 'Escape' })
    expect(screen.queryByTestId('cue-rule-0-bars-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-rule-0-from'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('cue-rule-0-from-menu')).toBeNull()
  })

  it('puts the preview first and the rules under it', () => {
    render(<Harness />)
    const preview = screen.getByTestId('cue-flow-preview')
    expect(
      preview.compareDocumentPosition(screen.getByTestId('cue-rule-0')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps the preview and the rules of a flow in one piece, the preview first and Añadir regla after the last rule, so what a rule does is seen right over it', () => {
    render(<Harness />)
    const bench = screen.getByTestId('cue-flow-bench')
    const inside = [
      'cue-flow-preview',
      'cue-rule-0',
      'cue-rule-1',
      'cue-flow-mark-point',
      'cue-rule-add',
    ].map((id) => within(bench).getByTestId(id))
    for (let i = 1; i < inside.length; i++)
      expect(
        inside[i - 1].compareDocumentPosition(inside[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    expect(within(bench).queryAllByRole('heading')).toEqual([])
    expect(within(bench).getByRole('region', { name: 'Rules' })).toContainElement(inside[1])
  })

  it('pins the preview to the top of Settings on a square strip of the panel colour as wide as the piece, so nothing scrolling under it shows through its round corners, below the lists a rule opens', () => {
    render(<Harness />)
    const pin = screen.getByTestId('cue-flow-bench-pin')
    const card = screen.getByTestId('cue-flow-bench-preview')
    expect(pin.parentElement).toBe(screen.getByTestId('cue-flow-bench'))
    expect(pin).toHaveClass('sticky', 'top-0', 'z-10', 'bg-[var(--color-panel)]')
    expect(pin.className).not.toMatch(/rounded|(?<![\w-])(?:p|m)[xlr]?-/)
    expect(pin).toContainElement(card)
    expect(card).toContainElement(screen.getByTestId('cue-flow-preview'))
    expect(card).toHaveClass('rounded-t-lg', 'bg-[var(--color-field)]')
    expect(card.className).not.toContain('sticky')
    expect(pin).not.toContainElement(screen.getByTestId('cue-rule-0'))
  })

  it('insets the preview by the same amount on both sides as the text of a rule, so the selector, the wave, the status line and the rules share one left edge with room for the ring of a new cue', () => {
    render(<Harness />)
    const card = screen.getByTestId('cue-flow-bench-preview')
    expect(card).toHaveClass('px-3.5')
    expect(card.className).not.toMatch(/(?<![\w-])p[lr]-/)
    expect(screen.getByTestId('cue-rule-0')).toHaveClass('pl-3.5')
    expect(screen.getByTestId('cue-flow-preview').className).not.toMatch(/(?<![\w-])[pm][xlr]?-/)
  })

  it('draws a stronger line under the pinned preview, so it stays apart from the rules passing under it on the light theme too', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-flow-bench-preview')).toHaveClass(
      'border',
      'border-[var(--color-line)]',
      'border-b-[var(--color-line-strong)]',
    )
  })

  it('never clips the piece of the preview and the rules, so their lists keep placing themselves against the edges of Settings', () => {
    render(<Harness />)
    const bench = screen.getByTestId('cue-flow-bench')
    const clipping = [
      bench,
      ...Array.from(bench.querySelectorAll('section, [data-testid="cue-flow-bench-pin"]')),
    ].filter((el) => /overflow-/.test(el.className))
    expect(clipping).toEqual([])
    expect(bench.querySelectorAll('section, [data-testid="cue-flow-bench-pin"]')).toHaveLength(3)
  })

  it('sets the arrow jump of the manual editor in its own card', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-jump-16')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('cue-jump-32'))
    expect(last?.cueJumpBars).toBe(32)
    expect(screen.getByTestId('cue-jump-32')).toHaveAttribute('aria-pressed', 'true')
  })

  it('sets the quantize of the manual editor in the same card, the bar by default', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    const card = screen.getByTestId('cue-manual')
    expect(within(card).getByTestId('cue-quantize-bar')).toHaveTextContent('Compás')
    expect(within(card).getByTestId('cue-quantize-bar')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(card).getByTestId('cue-quantize-beat'))
    expect(last?.cueQuantize).toBe('beat')
    expect(screen.getByTestId('cue-quantize-beat')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cue-quantize-beat')).toHaveTextContent('Golpe')
  })

  it('sets how far a cue may sit from its beat before the list filter calls it off the grid, 10 ms by default', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    const card = screen.getByTestId('cue-manual')
    expect(within(card).getByTestId('cue-grid-tolerance-10')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(card).getByTestId('cue-grid-tolerance-20')).toHaveTextContent('20 ms')
    fireEvent.click(within(card).getByTestId('cue-grid-tolerance-20'))
    expect(last?.cueGridTolerance).toBe(20)
    expect(screen.getByTestId('cue-grid-tolerance-20')).toHaveAttribute('aria-pressed', 'true')
    expect(card).toHaveTextContent('Cues fuera de la rejilla')
  })

  it('keeps the invitation to teach Surco at the end of the tab while nothing was learned, since the flow is what the tab is for, and + only makes a new flow', async () => {
    installApi()
    render(<Harness collection="/rb/master.db" />)
    const card = await screen.findByTestId('cue-profile')
    expect(card).toBeVisible()
    expect(
      screen.getByTestId('cue-manual').compareDocumentPosition(card) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(within(card).getByRole('heading')).toHaveTextContent('Surco will learn how you mark')
    openAdd()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('cue-flow-name')).toHaveFocus()
  })

  it('keeps what Surco learned in the same place at the end of the tab once it learned, under its own section title', async () => {
    installApi({
      cueProfile: vi.fn<Api['cueProfile']>(async () => ({
        profile: LEARNED,
        edits: { count: 0, sinceLearn: 0, corrected: 0 },
        marked: 40,
      })),
    })
    render(<Harness collection="/rb/master.db" />)
    const card = await screen.findByTestId('cue-profile')
    expect(card).toBeVisible()
    expect(
      screen.getByTestId('cue-manual').compareDocumentPosition(card) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(within(card).getByRole('heading')).toHaveTextContent(/^How you mark$/)
    expect(screen.getByTestId('cue-profile-summary')).toHaveTextContent(
      /^Learned from 40 tracks you already marked/,
    )
  })

  describe('the rest of the tab, under the flow', () => {
    it('shows the programs, the manual editor and what Surco learned always open under the flow in that order, since no other tab of Settings folds its sections', async () => {
      installApi()
      render(<Harness collection="/c/master.db" />)
      await screen.findByTestId('cue-profile')
      const parts = ['cue-flow-bench', 'cue-flow-targets', 'cue-manual', 'cue-profile'].map((id) =>
        screen.getByTestId(id),
      )
      for (let i = 1; i < parts.length; i++)
        expect(
          parts[i - 1].compareDocumentPosition(parts[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
      for (const part of parts) expect(part).toBeVisible()
      expect(screen.getByTestId('cue-flow-targets-help')).toBeVisible()
      expect(screen.getByTestId('cue-letters')).toBeVisible()
      expect(screen.queryByTestId(/^cue-section-/)).toBeNull()
      expect(
        screen
          .getAllByRole('button')
          .filter(
            (b) =>
              b.closest('[data-testid="cue-flow-bench"]') === null &&
              b.hasAttribute('aria-controls'),
          ),
      ).toEqual([])
    })

    it('keeps each program on one row, the box and the name on the left and what it gets in grey against the right edge, cut with an ellipsis before it wraps', async () => {
      await i18n.changeLanguage('es')
      afterTest = () => i18n.changeLanguage('en')
      installApi({
        dj: djReads({
          traktor: { available: async () => true },
          engine: { available: async () => true },
          serato: { available: async () => true },
          virtualdj: { available: async () => true },
        }),
      })
      render(<Harness collection="/c/master.db" />)
      await waitFor(() =>
        expect(screen.getByTestId('settings-cue-flow-to-virtualdj')).toBeEnabled(),
      )
      const gets = {
        rekordbox: 'Hot cues y CALL',
        traktor: 'Solo hot cues, en azul, de la A a la G',
        engine: 'Solo hot cues',
        serato: 'Solo hot cues, de la A a la H',
        virtualdj: 'Solo hot cues, de la A a la H',
      }
      for (const [library, text] of Object.entries(gets)) {
        const row = screen.getByTestId(`cue-flow-target-${library}`)
        expect(row).toHaveClass('flex', 'items-center')
        expect(row).toContainElement(screen.getByTestId(`settings-cue-flow-to-${library}`))
        const said = within(row).getByTestId(`settings-cue-flow-to-${library}-gets`)
        expect(said.textContent).toBe(text)
        expect(said).toHaveClass(
          'min-w-0',
          'flex-1',
          'truncate',
          'text-right',
          'text-xs',
          'text-fg-dim',
        )
        expect(row.querySelectorAll('p')).toHaveLength(0)
      }
      expect(screen.getByTestId('cue-flow-targets').children).toHaveLength(5)
    })

    it('puts the catch of a program behind an (i) beside its name, only on the programs that have one, so the row stays one line', async () => {
      await i18n.changeLanguage('es')
      afterTest = () => i18n.changeLanguage('en')
      installApi({
        dj: djReads({
          traktor: { available: async () => true },
          engine: { available: async () => true },
          serato: { available: async () => true },
          virtualdj: { available: async () => true },
        }),
      })
      render(<Harness collection="/c/master.db" />)
      await waitFor(() =>
        expect(screen.getByTestId('settings-cue-flow-to-virtualdj')).toBeEnabled(),
      )
      const catches = {
        traktor:
          'Traktor lee su colección al arrancar, así que al guardar Surco te pedirá cerrarlo',
        serato: 'Si Serato está abierto, Surco los guarda cuando lo cierras',
        virtualdj: 'Si VirtualDJ está abierto, Surco los guarda cuando lo cierras',
      }
      for (const [library, text] of Object.entries(catches)) {
        const info = screen.getByTestId(`settings-cue-flow-to-${library}-caveat`)
        expect(screen.getByTestId(`cue-flow-target-${library}`)).toContainElement(info)
        expect(info.tagName).toBe('BUTTON')
        expect(info).toHaveClass('press')
        expect(info).not.toHaveAttribute('title')
        expect(info).toHaveAccessibleName(text)
        expect(info.closest('label')).toBeNull()
        expect(hoverTooltip(info)).toBe(text)
      }
      expect(screen.queryByTestId('settings-cue-flow-to-rekordbox-caveat')).toBeNull()
      expect(screen.queryByTestId('settings-cue-flow-to-engine-caveat')).toBeNull()
    })

    it('says a program is missing in place of what it would get and drops its (i), since nothing is saved there', async () => {
      installApi({
        dj: djReads({
          traktor: { available: async () => false },
          serato: { available: async () => false },
        }),
      })
      render(<Harness />)
      const missing = await screen.findByTestId('settings-cue-flow-to-serato-missing')
      expect(screen.getByTestId('cue-flow-target-serato')).toContainElement(missing)
      expect(missing).toHaveClass(
        'min-w-0',
        'flex-1',
        'truncate',
        'text-right',
        'text-xs',
        'text-fg-dim',
      )
      expect(screen.queryByTestId('settings-cue-flow-to-serato-gets')).toBeNull()
      expect(screen.queryByTestId('settings-cue-flow-to-serato-caveat')).toBeNull()
      expect(screen.queryByTestId('settings-cue-flow-to-traktor-caveat')).toBeNull()
      expect(screen.getByTestId('settings-cue-flow-to-serato').closest('label')).toHaveClass(
        'opacity-50',
      )
    })

    it('heads the programs list and the manual editor with a section title like the other tabs of Settings, the help of the programs inside its title', () => {
      installApi()
      render(<Harness collection="/c/master.db" />)
      const programs = screen.getByRole('heading', { name: /^Also place the flows in/ })
      expect(programs).toHaveClass('text-section', 'font-semibold', 'text-fg-muted')
      expect(programs).toContainElement(screen.getByTestId('cue-flow-targets-help'))
      expect(
        programs.compareDocumentPosition(screen.getByTestId('cue-flow-targets')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      const manual = screen.getByRole('heading', { name: 'Manual editor' })
      expect(manual).toHaveClass('text-section', 'font-semibold', 'text-fg-muted')
      expect(
        manual.compareDocumentPosition(screen.getByTestId('cue-manual')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'DJ software' })).toBeNull()
    })
  })

  it('names + in Surco’s own tooltip, not the native one', async () => {
    installApi()
    render(<Harness />)
    const add = screen.getByTestId('cue-flow-add')
    expect(add).not.toHaveAttribute('title')
    act(() => add.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent('New flow')
  })

  it('keeps the tooltip of + down when its menu closes and the focus comes back to it, so «New flow» is not left hanging over a button nobody is pointing at', async () => {
    installApi({
      cueProfile: vi.fn<Api['cueProfile']>(async () => ({
        profile: LEARNED,
        edits: { count: 0, sinceLearn: 0, corrected: 0 },
        marked: 40,
      })),
    })
    render(<Harness collection="/rb/master.db" flows={[MIX_IN]} active={MIX_IN.id} />)
    await screen.findByTestId('cue-profile')
    const add = screen.getByTestId('cue-flow-add')
    openAdd()
    expect(screen.getByTestId('cue-flow-add-new')).toHaveFocus()
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.keyDown(screen.getByTestId('cue-flow-add-new'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(add).toHaveFocus()
    expect(screen.queryByRole('tooltip')).toBeNull()
    openAdd()
    fireEvent.click(screen.getByTestId('cue-flow-add-learned'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(add).toHaveFocus()
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => add.blur())
    act(() => add.focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('New flow')
  })

  it('selects the flow made from what was learned, so the DJ sees it right away', async () => {
    const profile = {
      learnedAt: '2026-10-28T10:00:00.000Z',
      sources: { rekordbox: 40, edits: 0 },
      taste: null,
      check: null,
      flow: { id: 'learned', name: '', markPoint: true, rules: ONE_AT_32.rules },
      coverage: { matching: 30, marked: 40 },
      paired: 1,
      start: null,
    }
    installApi({
      cueProfile: vi.fn<Api['cueProfile']>(async () => ({
        profile,
        edits: { count: 0, sinceLearn: 0, corrected: 0 },
        marked: 40,
      })),
    })
    render(<Harness collection="/rb/master.db" flows={[MIX_IN]} active={MIX_IN.id} />)
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    await screen.findByTestId('cue-profile')
    openAdd()
    fireEvent.click(screen.getByTestId('cue-flow-add-learned'))
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Aprendido de mi colección')
    expect(last?.activeCueFlow).not.toBe(MIX_IN.id)
    expect(last?.cueFlows.at(-1)?.rules).toEqual(ONE_AT_32.rules)
  })

  it('offers what was learned from + as a second way to make a flow, the plain new flow still first', async () => {
    installApi({
      cueProfile: vi.fn<Api['cueProfile']>(async () => ({
        profile: LEARNED,
        edits: { count: 0, sinceLearn: 0, corrected: 0 },
        marked: 40,
      })),
    })
    render(<Harness collection="/rb/master.db" flows={[MIX_IN]} active={MIX_IN.id} />)
    await screen.findByTestId('cue-profile')
    expect(screen.queryByTestId('cue-profile-use-flow')).toBeNull()
    openAdd()
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.dataset.testid)).toEqual(['cue-flow-add-new', 'cue-flow-add-learned'])
    fireEvent.click(screen.getByTestId('cue-flow-add-new'))
    expect(screen.getByTestId('cue-flow-name')).toHaveFocus()
  })

  it('makes + a plain new flow again once a flow like the learned one exists, since there is nothing left to offer', async () => {
    installApi({
      cueProfile: vi.fn<Api['cueProfile']>(async () => ({
        profile: LEARNED,
        edits: { count: 0, sinceLearn: 0, corrected: 0 },
        marked: 40,
      })),
    })
    render(<Harness collection="/rb/master.db" flows={[MIX_IN, ONE_AT_32]} active={MIX_IN.id} />)
    await screen.findByTestId('cue-profile')
    openAdd()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('cue-flow-name')).toHaveFocus()
  })

  it('offers no flow from a track while the preview shows the example track, which nobody marked', async () => {
    installApi({ dj: glueCollection(), cues: { trackCues: async () => MARKED_BY_HAND } })
    render(<Harness flows={[MIX_IN]} active={MIX_IN.id} collection="/rb/master.db" />)
    openAdd()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('cue-flow-name')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('cue-flow-name'), { key: 'Enter' })
    await previewGlue()
    openAdd()
    expect(screen.getByTestId('cue-flow-add-track')).toBeInTheDocument()
    openAdd()
    fireEvent.click(screen.getByTestId('cue-preview-track'))
    fireEvent.click(screen.getByTestId('cue-preview-track-option-example'))
    openAdd()
    expect(screen.queryByTestId('cue-flow-add-track')).toBeNull()
    expect(screen.getByTestId('cue-flow-name')).toHaveFocus()
  })

  it('offers from + a flow from the track in the preview, named by its title so the DJ knows which marks it copies', async () => {
    installApi({ dj: glueCollection(), cues: { trackCues: async () => MARKED_BY_HAND } })
    render(<Harness flows={[MIX_IN]} active={MIX_IN.id} collection="/rb/master.db" />)
    await previewGlue()
    openAdd()
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.dataset.testid)).toEqual(['cue-flow-add-new', 'cue-flow-add-track'])
    expect(items[1]).toHaveAccessibleName('From “Bicep, Glue”')
  })

  it('selects the flow made from the previewed track and stays on that track, so the comparison says at once that the flow reproduces it', async () => {
    installApi({ dj: glueCollection(), cues: { trackCues: async () => MARKED_BY_HAND } })
    render(<Harness flows={[MIX_IN]} active={MIX_IN.id} collection="/rb/master.db" />)
    await previewGlue()
    expect(screen.queryByTestId('cue-preview-same')).toBeNull()
    openAdd()
    fireEvent.click(screen.getByTestId('cue-flow-add-track'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByTestId('cue-flow-name')).toBeNull()
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent('Like “Bicep, Glue”')
    expect(last?.cueFlows).toHaveLength(2)
    expect(last?.cueFlows[1].id).not.toBe(MIX_IN.id)
    expect(last?.cueFlows[1].rules).toEqual(flowFromTrack(MARKED_BY_HAND)?.rules)
    expect(screen.getAllByTestId(/^cue-rule-\d+$/)).toHaveLength(1)
    expect(screen.getByTestId('cue-rule-0')).toHaveTextContent('16')
    expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Bicep, Glue')
    expect(screen.getByTestId('cue-preview-same')).toBeInTheDocument()
  })

  it('leaves the default flow as it was when a flow is made from the previewed track, since trying one track must not change what every other track gets', async () => {
    installApi({ dj: glueCollection(), cues: { trackCues: async () => MARKED_BY_HAND } })
    render(<Harness flows={[MIX_IN]} active={MIX_IN.id} collection="/rb/master.db" />)
    await previewGlue()
    openAdd()
    fireEvent.click(screen.getByTestId('cue-flow-add-track'))
    expect(last?.cueFlows).toHaveLength(2)
    expect(last?.activeCueFlow).toBe(MIX_IN.id)
    expect(screen.getByTestId('cue-flow-picker')).toHaveTextContent(/^Like “Bicep, Glue”$/)
    openPicker()
    expect(screen.getByTestId(`cue-flow-${MIX_IN.id}`)).toContainElement(
      screen.getByTestId('cue-flow-in-use'),
    )
    openMore()
    expect(screen.getByTestId('cue-flow-use')).toBeEnabled()
  })

  it('offers no flow from a track whose hot cues give no rule, since there would be nothing to make', async () => {
    installApi({
      dj: glueCollection(),
      cues: {
        trackCues: async () => ({ ...MARKED_BY_HAND, cues: MARKED_BY_HAND.cues.slice(0, 1) }),
      },
    })
    render(<Harness flows={[MIX_IN]} active={MIX_IN.id} collection="/rb/master.db" />)
    await previewGlue()
    openAdd()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('cue-flow-name')).toHaveFocus()
  })

  it('offers no flow from a track once a flow with those rules exists, so + never makes the same flow twice', async () => {
    installApi({ dj: glueCollection(), cues: { trackCues: async () => MARKED_BY_HAND } })
    const twin = { ...(flowFromTrack(MARKED_BY_HAND) as CueFlow), id: 'twin', name: 'Twin' }
    render(<Harness flows={[MIX_IN, twin]} active={MIX_IN.id} collection="/rb/master.db" />)
    await previewGlue()
    openAdd()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('cue-flow-name')).toHaveFocus()
  })

  it('lists the flow from the track after the learned one, the plain new flow still first', async () => {
    installApi({
      dj: glueCollection(),
      cues: { trackCues: async () => MARKED_BY_HAND },
      cueProfile: vi.fn<Api['cueProfile']>(async () => ({
        profile: LEARNED,
        edits: { count: 0, sinceLearn: 0, corrected: 0 },
        marked: 40,
      })),
    })
    render(<Harness collection="/rb/master.db" flows={[MIX_IN]} active={MIX_IN.id} />)
    await screen.findByTestId('cue-profile')
    await previewGlue()
    openAdd()
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.dataset.testid)).toEqual([
      'cue-flow-add-new',
      'cue-flow-add-learned',
      'cue-flow-add-track',
    ])
  })

  it('explains once where the flows also go, behind the (i) of the heading', () => {
    installApi()
    render(<Harness collection="/c/master.db" />)
    expect(screen.getByTestId('cue-flow-targets-help')).toHaveAttribute('role', 'note')
    expect(screen.getByTestId('cue-flow-targets-help')).toHaveTextContent(
      i18n.t('settings.cueFlows.targets.hint'),
    )
  })

  it('shows a program missing on this Mac unticked as well as off, since nothing goes there', async () => {
    installApi({
      dj: djReads({
        traktor: { available: async () => false },
        engine: { available: async () => false },
      }),
    })
    render(<Harness collection="/c/master.db" />)
    expect(screen.getByTestId('settings-cue-flow-to-traktor')).toBeDisabled()
    expect(screen.getByTestId('settings-cue-flow-to-traktor')).not.toBeChecked()
    expect(last?.cueFlowToTraktor).toBe(true)
  })

  // A flow placed in one program goes to the same file in the others the DJ keeps here.
  it('lets the DJ choose which programs a flow also reaches, each one always shown', async () => {
    installApi({
      dj: djReads({
        traktor: { available: async () => true },
        engine: { available: async () => false },
      }),
    })
    render(<Harness collection="/c/master.db" />)
    const traktor = screen.getByTestId('settings-cue-flow-to-traktor')
    await waitFor(() => expect(traktor).toBeEnabled())
    expect(screen.getByTestId('settings-cue-flow-to-rekordbox')).toBeEnabled()
    expect(screen.getByTestId('settings-cue-flow-to-engine')).toBeDisabled()
    expect(screen.getByTestId('settings-cue-flow-to-engine-missing')).toBeInTheDocument()
    fireEvent.click(traktor)
    expect(last?.cueFlowToTraktor).toBe(false)
    expect(last?.cueFlowToRekordbox).toBe(true)
  })

  it('lists the targets as rekordbox, Traktor, Engine DJ, Serato and VirtualDJ, in that order', () => {
    installApi()
    render(<Harness collection="/c/master.db" />)
    const rows = within(screen.getByTestId('cue-flow-targets')).getAllByRole('checkbox')
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'settings-cue-flow-to-rekordbox',
      'settings-cue-flow-to-traktor',
      'settings-cue-flow-to-engine',
      'settings-cue-flow-to-serato',
      'settings-cue-flow-to-virtualdj',
    ])
    expect(screen.getByTestId('cue-flow-targets')).toHaveTextContent(
      /rekordbox.*Traktor.*Engine DJ.*Serato.*VirtualDJ/s,
    )
  })

  it('lets the DJ take Serato out of the flows once its library is found', async () => {
    installApi({
      dj: djReads({ serato: { available: vi.fn<ProgramReads['available']>(async () => true) } }),
    })
    render(<Harness collection="/c/master.db" />)
    const serato = screen.getByTestId('settings-cue-flow-to-serato')
    await waitFor(() => expect(serato).toBeEnabled())
    expect(serato).toBeChecked()
    expect(screen.getByTestId('settings-cue-flow-to-serato-gets')).toHaveTextContent(
      'Hot cues only, from A to H',
    )
    fireEvent.click(serato)
    expect(last?.cueFlowToSerato).toBe(false)
    expect(last?.cueFlowToEngine).toBe(true)
  })

  it('names Serato when its library is not on this computer and leaves its box unticked', async () => {
    installApi({
      dj: djReads({ serato: { available: vi.fn<ProgramReads['available']>(async () => false) } }),
    })
    render(<Harness collection="/c/master.db" />)
    expect(await screen.findByTestId('settings-cue-flow-to-serato-missing')).toHaveTextContent(
      'Serato',
    )
    expect(screen.getByTestId('settings-cue-flow-to-serato')).toBeDisabled()
    expect(screen.getByTestId('settings-cue-flow-to-serato')).not.toBeChecked()
  })

  it('never says a program is missing before it answers, so nothing shows and then goes away', async () => {
    let answer: (found: boolean) => void = () => {}
    installApi({
      dj: djReads({
        engine: {
          available: vi.fn<ProgramReads['available']>(
            () => new Promise<boolean>((resolve) => (answer = resolve)),
          ),
        },
      }),
    })
    render(<Harness collection="/c/master.db" />)
    expect(screen.getByTestId('settings-cue-flow-to-engine')).toBeDisabled()
    expect(screen.queryByTestId('settings-cue-flow-to-engine-missing')).not.toBeInTheDocument()
    answer(true)
    await waitFor(() => expect(screen.getByTestId('settings-cue-flow-to-engine')).toBeEnabled())
    expect(screen.queryByTestId('settings-cue-flow-to-engine-missing')).not.toBeInTheDocument()
  })

  it('leaves the rekordbox box unticked and says so while no collection is set', () => {
    installApi({
      dj: djReads({
        traktor: { available: async () => false },
        engine: { available: async () => false },
      }),
    })
    render(<Harness collection="" />)
    expect(screen.getByTestId('settings-cue-flow-to-rekordbox')).toBeDisabled()
    expect(screen.getByTestId('settings-cue-flow-to-rekordbox')).not.toBeChecked()
    expect(screen.getByTestId('settings-cue-flow-to-rekordbox-missing')).toHaveTextContent(
      'rekordbox',
    )
  })

  it('names Engine DJ and Traktor when they are missing, and ticks each box only where found', async () => {
    installApi({
      dj: djReads({
        traktor: { available: async () => false },
        engine: { available: async () => true },
      }),
    })
    render(<Harness collection="/c/master.db" />)
    await waitFor(() => expect(screen.getByTestId('settings-cue-flow-to-engine')).toBeEnabled())
    expect(screen.getByTestId('settings-cue-flow-to-engine')).toBeChecked()
    expect(screen.getByTestId('settings-cue-flow-to-traktor')).not.toBeChecked()
    expect(screen.getByTestId('settings-cue-flow-to-traktor-missing')).toHaveTextContent('Traktor')
  })
})

describe('the tracks the preview offers', () => {
  const openTracks = () => fireEvent.click(screen.getByTestId('cue-preview-track'))
  const closeTracks = () => fireEvent.mouseDown(document.body)
  const offered = () => screen.getAllByRole('option').map((o) => o.textContent)

  it('reads the collection only when the choices are first opened and never again, so opening Settings costs nothing nobody asked for', async () => {
    const playlist = vi.fn(async () => [inCollection('rb:7', 'Glue')])
    const api = installApi({ dj: djReads({ rekordbox: { playlist } }) })
    render(<Harness collection="/rb/master.db" />)
    await waitFor(() => expect(api.dj.available).toHaveBeenCalled())
    expect(api.dj.playlist).not.toHaveBeenCalled()
    openTracks()
    await screen.findByTestId('cue-preview-track-option-rb:7')
    expect(api.dj.playlist).toHaveBeenCalledTimes(1)
    expect(api.dj.playlist).toHaveBeenCalledWith('rekordbox', ALL_TRACKS_ID)
    closeTracks()
    openTracks()
    closeTracks()
    openTracks()
    expect(screen.getByTestId('cue-preview-track-option-rb:7')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-preview-track-loading')).toBeNull()
    expect(api.dj.playlist).toHaveBeenCalledTimes(1)
  })

  it('shares the read with the rest of the app, so a collection the list already read is not read twice', async () => {
    const api = installApi({ dj: glueCollection() })
    const queries = createQueryClient()
    queries.setQueryData(
      ['source-playlist', 'rekordbox', ALL_TRACKS_ID],
      [inCollection('rb:3', 'Atlas')],
    )
    render(<Harness collection="/rb/master.db" queries={queries} />)
    openTracks()
    expect(offered()).toEqual(['Example track', 'Atlas'])
    expect(api.dj.playlist).not.toHaveBeenCalled()
  })

  it('says the collection is being read while it is, with the example still to pick, so a big library never looks like an empty one', async () => {
    let land: (entries: SourcePlaylistEntry[]) => void = () => {}
    const playlist = () =>
      new Promise<SourcePlaylistEntry[]>((resolve) => {
        land = resolve
      })
    installApi({ dj: djReads({ rekordbox: { playlist } }) })
    render(<Harness collection="/rb/master.db" />)
    openTracks()
    expect(await screen.findByTestId('cue-preview-track-loading')).toBeInTheDocument()
    expect(offered()).toEqual(['Example track'])
    fireEvent.click(screen.getByTestId('cue-preview-track-option-example'))
    expect(screen.queryByTestId('cue-preview-track-menu')).toBeNull()
    expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Example track')
    openTracks()
    expect(screen.getByTestId('cue-preview-track-loading')).toBeInTheDocument()
    await act(async () => land([inCollection('rb:7', 'Glue')]))
    await waitFor(() => expect(screen.queryByTestId('cue-preview-track-loading')).toBeNull())
    expect(offered()).toEqual(['Example track', 'Glue'])
  })

  it('offers every track of the whole collection by name whatever their accents, marked or not, with no playlist open anywhere', async () => {
    installApi({
      dj: collectionOf(
        inCollection('rb:1', 'Zebra'),
        inCollection('rb:2', 'Élan'),
        inCollection('rb:3', 'Unmarked', []),
        inCollection('rb:4', 'atlas'),
        inCollection('rb:5', 'Hot only', [{ ms: 32000, kind: 1 }]),
      ),
    })
    render(<Harness collection="/rb/master.db" />)
    openTracks()
    await screen.findByTestId('cue-preview-track-option-rb:1')
    expect(offered()).toEqual(['Example track', 'atlas', 'Élan', 'Hot only', 'Unmarked', 'Zebra'])
    expect(screen.getByTestId('cue-preview-track-search')).toHaveAttribute(
      'placeholder',
      'Search your rekordbox collection',
    )
  })

  it('keeps first the track the list had selected when it has marks, so the DJ finds the one they came with', async () => {
    installApi({
      cues: { trackCues: async () => ({ ...MARKED_BY_HAND, contentId: 'rb:9' }) },
      dj: collectionOf(inCollection('rb:1', 'Atlas'), inCollection('rb:9', 'Zebra')),
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CuesTab
          synced={{ cueFlows: KEPT, activeCueFlow: 'mine' } as unknown as SyncedDraft}
          patch={() => {}}
          rekordboxCollection="/rb/master.db"
          cueTrack={{ contentId: 'rb:9', label: 'Zebra' }}
        />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Zebra'))
    openTracks()
    await screen.findByTestId('cue-preview-track-option-rb:1')
    expect(offered()).toEqual(['Example track', 'Zebra', 'Atlas'])
    fireEvent.click(screen.getByTestId('cue-preview-track-option-rb:1'))
    await waitFor(() => expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Atlas'))
    openTracks()
    expect(offered()).toEqual(['Example track', 'Zebra', 'Atlas'])
  })

  it('reads nothing and offers only the example where there is no rekordbox library, with no search field and no line about what is missing', async () => {
    const api = installApi({ dj: glueCollection() })
    render(<Harness collection="" />)
    openTracks()
    await waitFor(() => expect(api.dj.available).toHaveBeenCalled())
    expect(api.dj.playlist).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cue-preview-track-search')).toBeNull()
    expect(screen.queryByTestId('cue-preview-track-separator')).toBeNull()
    expect(screen.queryByTestId('cue-preview-track-loading')).toBeNull()
    expect(screen.getByTestId('cue-preview-track-menu')).toHaveTextContent(/^Example track$/)
  })

  it('offers only the example when the collection has no track, since a search field with nothing to find reads as broken', async () => {
    const api = installApi({ dj: collectionOf() })
    render(<Harness collection="/rb/master.db" />)
    openTracks()
    await waitFor(() => expect(api.dj.playlist).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('cue-preview-track-loading')).toBeNull())
    expect(screen.queryByTestId('cue-preview-track-search')).toBeNull()
    expect(screen.getByTestId('cue-preview-track-menu')).toHaveTextContent(/^Example track$/)
    expect(screen.getByTestId('cue-preview-track-option-example')).toHaveFocus()
  })

  it('falls back to the example alone when the collection cannot be read, so a locked library never breaks Settings', async () => {
    const playlist = vi.fn(async (): Promise<SourcePlaylistEntry[]> => {
      throw new Error('database is locked')
    })
    installApi({ dj: djReads({ rekordbox: { playlist } }) })
    render(<Harness collection="/rb/master.db" queries={createQueryClient()} />)
    openTracks()
    await waitFor(() => expect(playlist).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('cue-preview-track-loading')).toBeNull())
    expect(screen.queryByTestId('cue-preview-track-search')).toBeNull()
    expect(screen.queryByTestId('cue-preview-track-separator')).toBeNull()
    expect(screen.getByTestId('cue-preview-track-menu')).toHaveTextContent(/^Example track$/)
    fireEvent.click(screen.getByTestId('cue-preview-track-option-example'))
    expect(screen.getByTestId('cue-preview-track')).toHaveTextContent('Example track')
  })
})
