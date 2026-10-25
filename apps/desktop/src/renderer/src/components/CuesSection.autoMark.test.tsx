// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { DropInput } from '../../../shared/dropDetect'
import type { Settings, TrackCues } from '../../../shared/types'
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { startDraft } from '../lib/cueDraft'
import {
  autoMarkOf,
  keepAutoMark,
  keepDraft,
  resetCueSession,
  unsavedCueTracks,
} from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

const detectDrops = vi.hoisted(() => vi.fn<(input: DropInput) => number[]>())
vi.mock('../../../shared/dropDetect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/dropDetect')>()),
  detectDrops,
}))

const KEPT: CueFlow[] = [MY_FLOW, ONE_AT_32]
const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000
const WORDS = new Uint16Array(3000).fill((7 << 13) | (20 << 2))
const READ: TrackCues = {
  contentId: '103',
  analysed: true,
  grid: GRID,
  strong: [],
  phrases: [{ ms: bar(56), kind: 'up' }],
  cues: [],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
}

afterEach(() => {
  cleanup()
  resetEditorSections()
  resetCueSession()
})

beforeEach(() => {
  detectDrops.mockReset().mockReturnValue([bar(64), bar(128)])
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 100,
    right: 400,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

function setup({
  read = READ,
  words = WORDS,
  settings = {},
}: {
  read?: TrackCues
  words?: Uint16Array | null
  settings?: Partial<Settings>
} = {}) {
  const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => 'queued')
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async (id) => ({
      ...read,
      contentId: id,
    })),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
    rekordboxCueWaveDetail: vi.fn<Api['rekordboxCueWaveDetail']>(async () => words),
    saveRekordboxCues,
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (cue = { contentId: '103', path: '/m/g.wav', label: 'Gowan' }) => (
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine', ...settings }}>
        <CuesSection cue={cue} open onToggle={vi.fn()} />
      </SettingsProvider>
    </QueryClientProvider>
  )
  const { rerender } = render(tree())
  return {
    saveRekordboxCues,
    changeTrack: (cue: { contentId: string; path: string; label: string }) => rerender(tree(cue)),
  }
}

const ready = () => waitFor(() => expect(screen.getByTestId('cue-detail')).toBeInTheDocument())
const autoButton = () => screen.getByTestId('cues-auto-mark')
const wordsLoaded = () => waitFor(() => expect(autoButton()).toBeEnabled())
const seekStrip = (ms: number) => {
  fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: ms / 1000 })
  fireEvent.mouseUp(window, { clientX: ms / 1000 })
}
const proposals = () =>
  screen.queryAllByTestId(/^cue-wave-proposal-/).map((el) => el.dataset.testid)
const realMarks = () => screen.queryAllByTestId(/^cue-wave-(hot|call)-/)
const ghostCalls = () =>
  screen
    .queryAllByTestId(/^cue-wave-ghost-call-/)
    .map((el) => el.dataset.testid)
    .sort()
const openFull = async () => {
  fireEvent.click(screen.getByTestId('section-maximize'))
  await waitFor(() =>
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true'),
  )
}
const autoMark = async () => {
  await wordsLoaded()
  fireEvent.click(autoButton())
}

describe('Auto marcar', () => {
  it('proposes nothing until the DJ asks, so the wave stays clean', async () => {
    setup()
    await ready()
    await wordsLoaded()
    expect(detectDrops).not.toHaveBeenCalled()
    expect(proposals()).toEqual([])
    expect(autoButton()).toHaveTextContent('Auto mark')
    expect(autoButton().className).toContain('border-[var(--color-accent)]')
  })

  it('sits in the section header next to the flow menu while folded', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('cues-flow-menu')).toContainElement(autoButton())
    expect(screen.getByTestId('cues-surface')).not.toContainElement(autoButton())
  })

  it('reads the track’s grid, phrases and detailed wave, what the detector was measured on', async () => {
    setup()
    await ready()
    await autoMark()
    expect(detectDrops).toHaveBeenCalledWith({
      grid: READ.grid,
      phrases: READ.phrases,
      words: WORDS,
    })
  })

  it('draws each proposal over both waves and asks with its time where the zoomed wave shows it', async () => {
    setup()
    await ready()
    await autoMark()
    expect(proposals()).toEqual([`cue-wave-proposal-${bar(64)}`, `cue-wave-proposal-${bar(128)}`])
    seekStrip(bar(64))
    expect(screen.getByTestId(`cue-detail-proposal-${bar(64)}`)).toBeInTheDocument()
    expect(screen.getByTestId(`cue-proposal-${bar(64)}`)).toHaveTextContent(
      'Does it break here? 2:08',
    )
    expect(screen.queryByTestId(`cue-proposal-${bar(128)}`)).toBeNull()
  })

  it('shows what the active flow would place on every proposal as ghosts, and places nothing yet', async () => {
    setup()
    await ready()
    await autoMark()
    expect(ghostCalls()).toEqual(
      expect.arrayContaining([`cue-wave-ghost-call-${bar(64)}`, `cue-wave-ghost-call-${bar(128)}`]),
    )
    expect(realMarks()).toHaveLength(0)
    expect(screen.getByTestId('cues-step-back')).toBeDisabled()
  })

  it('ghosts the proposals with the flow the DJ switches to, so the preview matches what accepting does', async () => {
    setup()
    await ready()
    await autoMark()
    expect(screen.getAllByTestId(/^cue-wave-ghost-hot-/)).toHaveLength(6)
    fireEvent.click(screen.getByTestId('cues-flow'))
    fireEvent.click(screen.getByTestId('cues-flow-option-one-at-32'))
    expect(screen.getAllByTestId(/^cue-wave-ghost-hot-/)).toHaveLength(2)
    expect(proposals()).toHaveLength(2)
  })

  it('offers to accept them all and to discard in full screen, and Descartar leaves the draft as it was', async () => {
    setup()
    await ready()
    await openFull()
    await autoMark()
    expect(screen.queryByTestId('cues-auto-mark')).toBeNull()
    expect(screen.getByTestId('cues-auto-accept')).toHaveTextContent('Accept the 2 suggestions')
    expect(screen.getByTestId('cues-auto-accept')).toHaveTextContent('↵')
    expect(screen.getByTestId('cues-auto-discard')).toHaveTextContent('Discard')
    fireEvent.click(screen.getByTestId('cues-auto-discard'))
    expect(proposals()).toEqual([])
    expect(realMarks()).toHaveLength(0)
    expect(screen.getByTestId('cues-step-back')).toBeDisabled()
    expect(autoButton()).toBeInTheDocument()
  })

  it('opens the pill toward the middle of the zoomed wave, so ✓ and ✕ never fall off its edge', async () => {
    setup()
    await ready()
    await autoMark()
    seekStrip(bar(60))
    const right = screen.getByTestId(`cue-proposal-${bar(64)}`)
    expect(right.style.right).toBe('25%')
    expect(right.style.left).toBe('')
    seekStrip(bar(68))
    const left = screen.getByTestId(`cue-proposal-${bar(64)}`)
    expect(left.style.left).toBe('25%')
    expect(left.style.right).toBe('')
  })

  it('takes one proposal away with its ✕ and keeps the rest', async () => {
    setup()
    await ready()
    await autoMark()
    seekStrip(bar(64))
    fireEvent.click(screen.getByTestId(`cue-proposal-drop-${bar(64)}`))
    expect(proposals()).toEqual([`cue-wave-proposal-${bar(128)}`])
    expect(screen.getByTestId('cues-auto-accept')).toHaveAccessibleName('Accept the suggestion')
    expect(realMarks()).toHaveLength(0)
  })

  it('keeps accept and discard to an icon and the count in the folded header, so the header holds one line with the maximize button', async () => {
    setup()
    await ready()
    await autoMark()
    const accept = screen.getByTestId('cues-auto-accept')
    expect(accept).toHaveAccessibleName('Accept the 2 suggestions')
    expect(accept).toHaveAttribute('title', 'Accept the 2 suggestions')
    expect(accept).toHaveTextContent(/^2↵$/)
    const discard = screen.getByTestId('cues-auto-discard')
    expect(discard).toHaveAccessibleName('Discard')
    expect(discard).toHaveTextContent('')
    fireEvent.click(discard)
    expect(proposals()).toEqual([])
  })

  it('leaves out a proposal in the bar of a CALL already there, so it never moves or doubles a point', async () => {
    setup({ read: { ...READ, cues: [{ id: 'c1', ms: bar(64) + 1000, kind: 0, color: null }] } })
    await ready()
    await autoMark()
    expect(proposals()).toEqual([`cue-wave-proposal-${bar(128)}`])
    expect(screen.getByTestId(`cue-wave-call-${bar(64) + 1000}`)).toBeInTheDocument()
  })

  it('drops a proposal once the DJ puts a CALL in its bar', async () => {
    setup()
    await ready()
    await openFull()
    await autoMark()
    seekStrip(bar(128))
    fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'm' })
    expect(proposals()).toEqual([`cue-wave-proposal-${bar(64)}`])
  })

  it('is there but off without the detailed wave, and says rekordbox has not analysed the track', async () => {
    setup({ words: null })
    await ready()
    await waitFor(() => expect(autoButton()).toBeDisabled())
    expect(autoButton()).toHaveAttribute('title', 'No rekordbox analysis')
  })

  it('says so when the detector finds nothing, instead of proposing anything', async () => {
    detectDrops.mockReturnValue([])
    setup()
    await ready()
    await autoMark()
    expect(screen.getByTestId('cues-auto-none')).toHaveTextContent(
      'Surco can’t find where this track breaks',
    )
    expect(proposals()).toEqual([])
    expect(autoButton()).toBeInTheDocument()
  })

  it('says every break it finds already has a CALL, instead of seeming to do nothing on a marked track', async () => {
    setup({
      read: {
        ...READ,
        cues: [
          { id: 'c1', ms: bar(64), kind: 0, color: null },
          { id: 'c2', ms: bar(128) + 500, kind: 0, color: null },
        ],
      },
    })
    await ready()
    await autoMark()
    expect(screen.getByTestId('cues-auto-marked')).toHaveTextContent(
      'You already have a CALL everywhere Surco thinks the track breaks',
    )
    expect(screen.queryByTestId('cues-auto-none')).toBeNull()
    expect(proposals()).toEqual([])
  })

  it('forgets the proposals on another track, since they belong to the track they were made for', async () => {
    const { changeTrack } = setup()
    await ready()
    await autoMark()
    changeTrack({ contentId: '104', path: '/m/h.wav', label: 'Other' })
    expect(await screen.findByTestId('cues-auto-mark')).toBeInTheDocument()
    expect(proposals()).toEqual([])
  })

  it('sits next to the flow menu in full screen too', async () => {
    setup()
    await ready()
    await openFull()
    const actions = screen.getByTestId('cues-toolbar')
    expect(within(actions).getByTestId('cues-auto-mark')).toBeInTheDocument()
    await autoMark()
    expect(within(actions).getByTestId('cues-auto-accept')).toBeInTheDocument()
  })
})

describe('accepting Auto marcar', () => {
  const calls = () =>
    screen
      .queryAllByTestId(/^cue-wave-call-/)
      .map((el) => el.dataset.testid)
      .sort()
  const hots = () => screen.queryAllByTestId(/^cue-wave-hot-/)
  const undo = () => fireEvent.click(screen.getByTestId('cues-step-back'))
  const press = (testId: string) => {
    const button = screen.getByTestId(testId)
    button.focus()
    fireEvent.click(button)
  }

  it('gives the focus back to the editor after ✓ or ✕, so Return still accepts what is left', async () => {
    setup()
    await ready()
    await autoMark()
    seekStrip(bar(64))
    press(`cue-proposal-drop-${bar(64)}`)
    expect(screen.getByTestId('cues-editor')).toHaveFocus()
    seekStrip(bar(128))
    press(`cue-proposal-accept-${bar(128)}`)
    expect(screen.getByTestId('cues-editor')).toHaveFocus()
  })

  it('keeps Return working after ✕ in full screen', async () => {
    setup()
    await ready()
    await openFull()
    await autoMark()
    seekStrip(bar(64))
    press(`cue-proposal-drop-${bar(64)}`)
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' })
    expect(calls()).toContain(`cue-wave-call-${bar(128)}`)
    expect(proposals()).toEqual([])
  })

  it('places one proposal with its ✓ as a point placed by hand, and keeps the others proposed', async () => {
    setup()
    await ready()
    await autoMark()
    seekStrip(bar(64))
    fireEvent.click(screen.getByTestId(`cue-proposal-accept-${bar(64)}`))
    expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toHaveAttribute('data-pending', 'true')
    expect(hots()).toHaveLength(3)
    expect(proposals()).toEqual([`cue-wave-proposal-${bar(128)}`])
    expect(screen.getByTestId('cues-unsaved')).toBeInTheDocument()
  })

  it('places every proposal with Aceptar and takes them all back with one undo', async () => {
    setup()
    await ready()
    await autoMark()
    fireEvent.click(screen.getByTestId('cues-auto-accept'))
    expect(calls()).toEqual(
      expect.arrayContaining([`cue-wave-call-${bar(128)}`, `cue-wave-call-${bar(64)}`]),
    )
    expect(hots()).toHaveLength(6)
    expect(proposals()).toEqual([])
    expect(autoButton()).toBeInTheDocument()
    undo()
    expect(realMarks()).toHaveLength(0)
    expect(screen.getByTestId('cues-step-back')).toBeDisabled()
  })

  it('accepts them all with Return while they are shown, folded or in full screen', async () => {
    setup()
    await ready()
    await autoMark()
    fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'Enter' })
    expect(hots()).toHaveLength(6)
    undo()
    await openFull()
    await autoMark()
    fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'Enter' })
    expect(hots()).toHaveLength(6)
    expect(proposals()).toEqual([])
  })

  it('keeps Return placing at the playhead once the proposals are discarded', async () => {
    setup()
    await ready()
    await autoMark()
    fireEvent.click(screen.getByTestId('cues-auto-discard'))
    seekStrip(bar(32))
    fireEvent.keyDown(screen.getByTestId('cues-editor'), { key: 'Enter' })
    expect(calls()).toContain(`cue-wave-call-${bar(32)}`)
    expect(calls()).not.toContain(`cue-wave-call-${bar(64)}`)
  })

  it('places a CALL on each proposal in Manual, as placing by hand does there', async () => {
    setup({ settings: { activeCueFlow: 'manual' } })
    await ready()
    await autoMark()
    fireEvent.click(screen.getByTestId('cues-auto-accept'))
    expect(calls()).toEqual([`cue-wave-call-${bar(64)}`, `cue-wave-call-${bar(128)}`])
    expect(hots()).toHaveLength(0)
  })

  it('forgets what is still proposed once the cues are saved', async () => {
    const { saveRekordboxCues } = setup()
    await ready()
    await autoMark()
    seekStrip(bar(64))
    fireEvent.click(screen.getByTestId(`cue-proposal-accept-${bar(64)}`))
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    expect(proposals()).toEqual([])
  })
})

describe('pending proposals', () => {
  it('shows the proposals a batch left for the track as soon as it opens, so the DJ only reviews', async () => {
    keepAutoMark('103', { kind: 'proposed', ms: [bar(64), bar(128)] })
    setup()
    await ready()
    expect(proposals()).toEqual([`cue-wave-proposal-${bar(64)}`, `cue-wave-proposal-${bar(128)}`])
    expect(screen.getByTestId('cues-auto-accept')).toBeInTheDocument()
    expect(detectDrops).not.toHaveBeenCalled()
  })

  it('keeps them when the DJ moves to another track and comes back, until they are answered', async () => {
    const { changeTrack } = setup()
    await ready()
    await autoMark()
    changeTrack({ contentId: '104', path: '/m/h.wav', label: 'Other' })
    expect(await screen.findByTestId('cues-auto-mark')).toBeInTheDocument()
    changeTrack({ contentId: '103', path: '/m/g.wav', label: 'Gowan' })
    await waitFor(() => expect(proposals()).toHaveLength(2))
  })

  it('leaves only what is still unanswered pending, so the row counts what is left to review', async () => {
    setup()
    await ready()
    await autoMark()
    expect(autoMarkOf('103')).toEqual({ kind: 'proposed', ms: [bar(64), bar(128)] })
    seekStrip(bar(64))
    fireEvent.click(screen.getByTestId(`cue-proposal-accept-${bar(64)}`))
    expect(autoMarkOf('103')).toEqual({ kind: 'proposed', ms: [bar(128)] })
  })

  it('leaves nothing pending once they are all accepted', async () => {
    setup()
    await ready()
    await autoMark()
    fireEvent.click(screen.getByTestId('cues-auto-accept'))
    expect(autoMarkOf('103')).toBeUndefined()
  })

  it('leaves nothing pending once Descartar throws them away', async () => {
    setup()
    await ready()
    await autoMark()
    fireEvent.click(screen.getByTestId('cues-auto-discard'))
    expect(autoMarkOf('103')).toBeUndefined()
  })

  it('records when the detector finds nothing or only marked breaks, so the row can say so', async () => {
    detectDrops.mockReturnValue([])
    setup()
    await ready()
    await autoMark()
    expect(autoMarkOf('103')).toEqual({ kind: 'none' })
  })

  it('says again what the detector found when the track opens after a batch', async () => {
    keepAutoMark('103', { kind: 'marked' })
    setup()
    await ready()
    expect(screen.getByTestId('cues-auto-marked')).toBeInTheDocument()
  })
})

describe('saving several tracks', () => {
  const other = () =>
    keepDraft('104', '104|f0|null', startDraft([{ ms: bar(32), kind: 0, color: null }], 'mine'), {
      path: '/m/h.wav',
      label: 'Other',
      fingerprint: 'f0',
    })

  it('saves every reviewed track to rekordbox in one go, so the collection is written once', async () => {
    other()
    const { saveRekordboxCues } = setup()
    await ready()
    await autoMark()
    fireEvent.click(screen.getByTestId('cues-auto-accept'))
    const all = await screen.findByTestId('cues-save-all')
    expect(all).toHaveTextContent('Save 2 tracks to rekordbox')
    fireEvent.click(all)
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(saveRekordboxCues.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        {
          contentId: '104',
          path: '/m/h.wav',
          label: 'Other',
          fingerprint: 'f0',
          wanted: [{ ms: bar(32), kind: 0, color: null }],
        },
        expect.objectContaining({ contentId: '103', path: '/m/g.wav', label: 'Gowan' }),
      ]),
    )
    expect(saveRekordboxCues.mock.calls[0][0]).toHaveLength(2)
    await waitFor(() => expect([...unsavedCueTracks()]).toEqual([]))
  })

  it('leaves out and forgets a draft built on a queued save that was discarded since, so its cues never come back', async () => {
    other()
    const queued = { wanted: [{ ms: bar(16), kind: 0, color: null }], fingerprint: 'f0' }
    keepDraft('105', `105|f0|${JSON.stringify(queued)}`, startDraft([], 'mine'), {
      path: '/m/s.wav',
      label: 'Stale',
      fingerprint: 'f0',
    })
    const { saveRekordboxCues } = setup()
    await ready()
    await autoMark()
    fireEvent.click(screen.getByTestId('cues-auto-accept'))
    fireEvent.click(await screen.findByTestId('cues-save-all'))
    await waitFor(() => expect([...unsavedCueTracks()]).toEqual([]))
    const saved = saveRekordboxCues.mock.calls.flatMap(([reqs]) => reqs.map((r) => r.contentId))
    expect(saved.sort()).toEqual(['103', '104'])
  })

  it('takes no second click while it saves, so a double click never queues the tracks twice', async () => {
    other()
    const { saveRekordboxCues } = setup()
    saveRekordboxCues.mockImplementation(() => new Promise(() => {}))
    await ready()
    await autoMark()
    fireEvent.click(screen.getByTestId('cues-auto-accept'))
    const all = await screen.findByTestId('cues-save-all')
    fireEvent.click(all)
    await waitFor(() => expect(all).toBeDisabled())
    fireEvent.click(all)
    await new Promise((r) => setTimeout(r, 20))
    expect(saveRekordboxCues).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the save fails', () => Promise.reject(new Error('ipc')), 'Could not save to rekordbox'],
    [
      'the queue belongs to another collection',
      async () => 'other-collection' as const,
      'What is waiting belongs to another rekordbox collection',
    ],
  ])('keeps every track unsaved and says why when %s', async (_, answer, said) => {
    other()
    const { saveRekordboxCues } = setup()
    saveRekordboxCues.mockImplementation(answer)
    await ready()
    await autoMark()
    fireEvent.click(screen.getByTestId('cues-auto-accept'))
    fireEvent.click(await screen.findByTestId('cues-save-all'))
    expect(await screen.findByTestId('cues-save-failed')).toHaveTextContent(said)
    expect([...unsavedCueTracks()].sort()).toEqual(['103', '104'])
    expect(screen.getByTestId('cues-save-all')).toBeEnabled()
  })

  it.each([
    ['the save fails', () => Promise.reject(new Error('ipc')), 'Could not save to rekordbox'],
    [
      'the queue belongs to another collection',
      async () => 'other-collection' as const,
      'What is waiting belongs to another rekordbox collection',
    ],
  ])('keeps a single Guardar unsaved and says why when %s', async (_, answer, said) => {
    const { saveRekordboxCues } = setup()
    saveRekordboxCues.mockImplementation(answer)
    await ready()
    await autoMark()
    fireEvent.click(screen.getByTestId('cues-auto-accept'))
    fireEvent.click(screen.getByTestId('cues-save'))
    expect(await screen.findByTestId('cues-save-failed')).toHaveTextContent(said)
    expect([...unsavedCueTracks()]).toEqual(['103'])
  })

  it('is not offered while only this track is unsaved, where its own Guardar does it', async () => {
    setup()
    await ready()
    await autoMark()
    fireEvent.click(screen.getByTestId('cues-auto-accept'))
    expect(screen.queryByTestId('cues-save-all')).toBeNull()
  })

  it('never saves what is still only proposed, on this track or another', async () => {
    other()
    keepAutoMark('105', { kind: 'proposed', ms: [bar(16)] })
    const { saveRekordboxCues } = setup()
    await ready()
    await autoMark()
    seekStrip(bar(64))
    fireEvent.click(screen.getByTestId(`cue-proposal-accept-${bar(64)}`))
    fireEvent.click(await screen.findByTestId('cues-save-all'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    const [reqs] = saveRekordboxCues.mock.calls[0]
    expect(reqs.map((r) => r.contentId).sort()).toEqual(['103', '104'])
    const mine = reqs.find((r) => r.contentId === '103')
    expect(mine?.wanted.some((c) => c.ms === bar(128))).toBe(false)
    expect(autoMarkOf('105')).toEqual({ kind: 'proposed', ms: [bar(16)] })
  })
})
