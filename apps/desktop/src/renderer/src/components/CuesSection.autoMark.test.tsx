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
import { resetCueSession } from '../lib/cueSession'
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
  const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => {})
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

  it('offers to accept them all and to discard, and Descartar leaves the draft as it was', async () => {
    setup()
    await ready()
    await autoMark()
    expect(screen.queryByTestId('cues-auto-mark')).toBeNull()
    expect(screen.getByTestId('cues-auto-accept')).toHaveTextContent('Accept the 2 suggestions')
    expect(screen.getByTestId('cues-auto-accept')).toHaveTextContent('↵')
    fireEvent.click(screen.getByTestId('cues-auto-discard'))
    expect(proposals()).toEqual([])
    expect(realMarks()).toHaveLength(0)
    expect(screen.getByTestId('cues-step-back')).toBeDisabled()
    expect(autoButton()).toBeInTheDocument()
  })

  it('takes one proposal away with its ✕ and keeps the rest', async () => {
    setup()
    await ready()
    await autoMark()
    seekStrip(bar(64))
    fireEvent.click(screen.getByTestId(`cue-proposal-drop-${bar(64)}`))
    expect(proposals()).toEqual([`cue-wave-proposal-${bar(128)}`])
    expect(screen.getByTestId('cues-auto-accept')).toHaveTextContent('Accept the suggestion')
    expect(realMarks()).toHaveLength(0)
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
    const actions = screen.getByTestId('cues-actions')
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
