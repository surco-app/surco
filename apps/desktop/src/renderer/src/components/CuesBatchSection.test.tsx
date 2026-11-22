// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import { HOT_KINDS } from '../../../shared/cueRules'
import type { GridCheck } from '../../../shared/gridAudit'
import { type CommentMode, phrasedComment } from '../../../shared/phraseCount'
import type { LibraryTracks, Settings, TrackCues } from '../../../shared/types'
import i18n from '../i18n'
import { startDraft } from '../lib/cueDraft'
import {
  autoMarkOf,
  cueDraftKey,
  keepAutoMark,
  keepDraft,
  keptDrafts,
  resetCueSession,
  subscribeCueDrafts,
  unsavedCueTracks,
} from '../lib/cueSession'
import type { PhrasedComment } from '../lib/phraseCountBatch'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesBatchSection } from './CuesBatchSection'

const recordCueEdits = vi.hoisted(() => vi.fn())
vi.mock('../lib/cueTasteEdits', () => ({ recordCueEdits }))

const KEPT: CueFlow[] = [MY_FLOW, ONE_AT_32]
const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000
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
  gridFingerprint: '',
}
const ON_BEATS: GridCheck = { kind: 'measured', medianMs: 2, sustainedMs: -3 }
const LATE: GridCheck = { kind: 'measured', medianMs: -102, sustainedMs: -101 }
const TARGETS = [
  { contentId: '103', path: '/m/a.wav', label: 'Maniac' },
  { contentId: '104', path: '/m/b.wav', label: 'Summer Sky' },
]

afterEach(() => {
  cleanup()
  resetCueSession()
})

function setup(
  twins: Record<string, LibraryTracks> = {},
  targets = TARGETS,
  cues: Record<string, TrackCues['cues']> = {},
  phrased: PhrasedComment[] = [],
) {
  const calls: string[] = []
  const askToApply = vi.fn<Api['dj']['askToApply']>(async () => {
    calls.push('askToApply')
    return {}
  })
  const saveRekordboxCues = vi.fn<Api['cues']['save']>(async () => {
    calls.push('save')
  })
  const saveComments = vi.fn<Api['cues']['saveComments']>(async () => {
    calls.push('saveComments')
    return { failed: [] }
  })
  const api = installApi({
    cues: {
      twins: vi.fn<Api['cues']['twins']>(async (file) => twins[file] ?? {}),
      trackCues: vi.fn<Api['cues']['trackCues']>(async (id) => ({
        ...READ,
        contentId: id,
        cues: cues[id] ?? [],
      })),
      liveCues: vi.fn<Api['cues']['liveCues']>(async (ids) =>
        Object.fromEntries(
          ids.map((id) => [id, { cues: cues[id] ?? [], fingerprint: READ.fingerprint }]),
        ),
      ),
      queued: vi.fn<Api['cues']['queued']>(async () => null),
      save: saveRekordboxCues,
      saveComments,
    },
  })
  api.dj.askToApply = askToApply
  const onMark = vi.fn()
  const onFlow = vi.fn()
  const onShowBadGrid = vi.fn()
  const onShowMarked = vi.fn()
  const onPhrases = vi.fn(async () => ({ done: 1, skipped: 1, comments: phrased }))
  const onRestoreComments = vi.fn()
  const onRecomposeComments = vi.fn((comments: PhrasedComment[], mode: CommentMode) =>
    comments.map((c) => ({ ...c, after: phrasedComment(c.before, c.count, mode) })),
  )
  const onCommentsSaved = vi.fn()
  const onSaveSettings = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (over: Partial<Settings>, shown = targets) => (
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine', ...over }}>
        <CuesBatchSection
          targets={shown}
          onMark={onMark}
          onFlow={onFlow}
          gridCheckOf={(contentId) => (contentId === '103' ? LATE : ON_BEATS)}
          onShowBadGrid={onShowBadGrid}
          onShowMarked={onShowMarked}
          onOpen={vi.fn()}
          onPhrases={onPhrases}
          onRestoreComments={onRestoreComments}
          onRecomposeComments={onRecomposeComments}
          onCommentsSaved={onCommentsSaved}
          onSaveSettings={onSaveSettings}
        />
      </SettingsProvider>
    </QueryClientProvider>
  )
  const { rerender } = render(tree({}))
  const changeSettings = (over: Partial<Settings>) => rerender(tree(over))
  const changeTargets = (shown: typeof TARGETS) => rerender(tree({}, shown))
  return {
    saveRekordboxCues,
    askToApply,
    calls,
    onMark,
    onFlow,
    onShowBadGrid,
    onShowMarked,
    onPhrases,
    onRestoreComments,
    onRecomposeComments,
    onCommentsSaved,
    onSaveSettings,
    saveComments,
    changeSettings,
    changeTargets,
  }
}

describe('Phrases over several selected tracks', () => {
  it('puts the phrases in every comment at once and says how many had too few CALLs, so the DJ knows which tracks still need marking', async () => {
    const { onPhrases } = setup()
    fireEvent.click(screen.getByTestId('cues-batch-phrases'))
    expect(onPhrases).toHaveBeenCalledExactlyOnceWith('prepend')
    expect(await screen.findByTestId('cues-batch-phrases-done')).toHaveTextContent(
      i18n.t('editor.cues.batch.phrasesDone', { count: 1 }),
    )
    expect(screen.getByTestId('cues-batch-phrases-skipped')).toHaveTextContent(
      i18n.t('editor.cues.batch.phrasesSkipped', { count: 1 }),
    )
  })

  it('turns the button off while counting, so a second click does not read the playlist twice', async () => {
    const { onPhrases } = setup()
    fireEvent.click(screen.getByTestId('cues-batch-phrases'))
    expect(screen.getByTestId('cues-batch-phrases')).toBeDisabled()
    await screen.findByTestId('cues-batch-phrases-done')
    expect(onPhrases).toHaveBeenCalledTimes(1)
  })
  const PHRASED: PhrasedComment[] = [
    {
      id: 'a',
      contentId: '103',
      path: '/m/a.wav',
      label: 'Maniac',
      count: '2 - 8',
      before: 'Vocal fuerte',
      after: '2 - 8 · Vocal fuerte',
    },
    {
      id: 'b',
      contentId: '104',
      path: '/m/b.wav',
      label: 'Summer Sky',
      count: '4',
      before: '',
      after: '4',
    },
    {
      id: 'c',
      contentId: 'traktor:M/:m/:c.wav',
      path: '/m/c.wav',
      label: 'Gone',
      count: '3',
      before: '',
      after: '3',
    },
  ]
  const putPhrases = async () => {
    fireEvent.click(screen.getByTestId('cues-batch-phrases'))
    return screen.findByTestId('cues-batch-comments-save')
  }

  it('offers to save only the rekordbox counts after putting phrases, so a Traktor track is not promised a rekordbox write', async () => {
    setup({}, TARGETS, {}, PHRASED)
    expect(await putPhrases()).toHaveTextContent(
      i18n.t('editor.cues.batch.saveComments', { count: 2 }),
    )
    expect(screen.getByTestId('cues-batch-comments-discard')).toHaveTextContent(
      i18n.t('editor.cues.batch.clearDiscard'),
    )
  })

  it('asks to close rekordbox and sends only where the count goes, so no other tag of the form reaches rekordbox', async () => {
    const { calls, askToApply, saveComments } = setup({}, TARGETS, {}, PHRASED)
    fireEvent.click(await putPhrases())
    await waitFor(() => expect(saveComments).toHaveBeenCalledTimes(1))
    expect(askToApply).toHaveBeenCalledWith(['rekordbox'])
    expect(calls).toEqual(['askToApply', 'saveComments'])
    expect(saveComments).toHaveBeenCalledWith(
      [
        { contentId: '103', path: '/m/a.wav', label: 'Maniac', count: '2 - 8', mode: 'prepend' },
        { contentId: '104', path: '/m/b.wav', label: 'Summer Sky', count: '4', mode: 'prepend' },
      ],
      true,
    )
  })

  it('hands the saved comments to the form with where they went and hides the row, so the form either rereads the file or gets its comment back', async () => {
    const { onCommentsSaved, onRestoreComments } = setup({}, TARGETS, {}, PHRASED)
    fireEvent.click(await putPhrases())
    await waitFor(() => expect(onCommentsSaved).toHaveBeenCalledWith(PHRASED.slice(0, 2), true))
    expect(onRestoreComments).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('cues-batch-comments-save')).toBeNull())
    expect(screen.getByTestId('cues-batch-phrases-done')).toBeInTheDocument()
  })

  it('discards without writing to rekordbox and gives the comments back, so nothing of the batch stays behind', async () => {
    const { onRestoreComments, saveComments } = setup({}, TARGETS, {}, PHRASED)
    await putPhrases()
    fireEvent.click(screen.getByTestId('cues-batch-comments-discard'))
    expect(onRestoreComments).toHaveBeenCalledWith(PHRASED.slice(0, 2))
    expect(saveComments).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cues-batch-comments-save')).toBeNull()
    expect(screen.queryByTestId('cues-batch-phrases-done')).toBeNull()
  })

  it('shows no save row when no counted track is in rekordbox, as there is nowhere to save them', async () => {
    setup({}, TARGETS, {}, PHRASED.slice(2))
    fireEvent.click(screen.getByTestId('cues-batch-phrases'))
    await screen.findByTestId('cues-batch-phrases-done')
    expect(screen.queryByTestId('cues-batch-comments-save')).toBeNull()
  })

  it('turns Descartar off while saving, so a discard mid-save cannot leave rekordbox written behind the DJ', async () => {
    const { saveComments, onRestoreComments } = setup({}, TARGETS, {}, PHRASED)
    let finish = () => {}
    saveComments.mockImplementationOnce(
      () =>
        new Promise<{ failed: string[] }>((resolve) => {
          finish = () => resolve({ failed: [] })
        }),
    )
    fireEvent.click(await putPhrases())
    await waitFor(() => expect(saveComments).toHaveBeenCalledTimes(1))
    const discard = screen.getByTestId('cues-batch-comments-discard')
    expect(discard).toBeDisabled()
    fireEvent.click(discard)
    expect(onRestoreComments).not.toHaveBeenCalled()
    await act(async () => finish())
  })

  it('keeps the first comment of a track phrased twice and saves its latest count, so the form gets back what the DJ had', async () => {
    const { onPhrases, saveComments, onCommentsSaved } = setup({}, TARGETS, {}, PHRASED)
    await putPhrases()
    const again = {
      ...PHRASED[0],
      count: '4 - 8',
      before: PHRASED[0].after,
      after: '4 - 8 · Vocal fuerte',
    }
    onPhrases.mockResolvedValueOnce({ done: 1, skipped: 0, comments: [again] })
    fireEvent.click(screen.getByTestId('cues-batch-phrases'))
    await waitFor(() => expect(onPhrases).toHaveBeenCalledTimes(2))
    fireEvent.click(await screen.findByTestId('cues-batch-comments-save'))
    await waitFor(() =>
      expect(saveComments).toHaveBeenCalledWith(
        [
          { contentId: '103', path: '/m/a.wav', label: 'Maniac', count: '4 - 8', mode: 'prepend' },
          { contentId: '104', path: '/m/b.wav', label: 'Summer Sky', count: '4', mode: 'prepend' },
        ],
        true,
      ),
    )
    await waitFor(() =>
      expect(onCommentsSaved).toHaveBeenCalledWith(
        [{ ...again, before: 'Vocal fuerte' }, PHRASED[1]],
        true,
      ),
    )
  })

  it('keeps the tracks phrased in an earlier selection when phrasing another, so saving covers both groups', async () => {
    const { onPhrases, saveComments } = setup({}, TARGETS, {}, PHRASED.slice(0, 1))
    await putPhrases()
    onPhrases.mockResolvedValueOnce({ done: 1, skipped: 0, comments: PHRASED.slice(1, 2) })
    fireEvent.click(screen.getByTestId('cues-batch-phrases'))
    await waitFor(() =>
      expect(screen.getByTestId('cues-batch-comments-save')).toHaveTextContent(
        i18n.t('editor.cues.batch.saveComments', { count: 2 }),
      ),
    )
    fireEvent.click(screen.getByTestId('cues-batch-comments-save'))
    await waitFor(() =>
      expect(saveComments).toHaveBeenCalledWith(
        [
          { contentId: '103', path: '/m/a.wav', label: 'Maniac', count: '2 - 8', mode: 'prepend' },
          { contentId: '104', path: '/m/b.wav', label: 'Summer Sky', count: '4', mode: 'prepend' },
        ],
        true,
      ),
    )
  })

  it('keeps the row and says it failed when rekordbox refuses, so the DJ can try again', async () => {
    const { saveComments, onCommentsSaved } = setup({}, TARGETS, {}, PHRASED)
    saveComments.mockRejectedValueOnce(new Error('locked'))
    fireEvent.click(await putPhrases())
    expect(await screen.findByTestId('cues-batch-comments-failed')).toHaveTextContent(
      i18n.t('editor.cues.saveFailed'),
    )
    expect(screen.getByTestId('cues-batch-comments-save')).toBeEnabled()
    expect(onCommentsSaved).not.toHaveBeenCalled()
  })

  const openOptions = () => fireEvent.click(screen.getByTestId('cues-batch-comments-options'))

  it('saves to the file and rekordbox by default, so the phrases reach every program that reads the tag', async () => {
    const { saveComments } = setup({}, TARGETS, {}, PHRASED)
    const save = await putPhrases()
    expect(save).toHaveTextContent('Save 2 comments')
    fireEvent.click(save)
    await waitFor(() => expect(saveComments).toHaveBeenCalledTimes(1))
    expect(saveComments.mock.calls[0][1]).toBe(true)
    expect(saveComments.mock.calls[0][0].map((i) => i.mode)).toEqual(['prepend', 'prepend'])
  })

  it('asks rekordbox only when picked and remembers it, so a DJ who keeps files untouched is not asked again', async () => {
    const { saveComments, onSaveSettings, onCommentsSaved, changeSettings } = setup(
      {},
      TARGETS,
      {},
      PHRASED,
    )
    await putPhrases()
    openOptions()
    fireEvent.click(screen.getByTestId('cues-batch-comments-rekordbox-only'))
    expect(onSaveSettings).toHaveBeenCalledWith({ commentsToFile: false })
    changeSettings({ commentsToFile: false })
    openOptions()
    expect(screen.getByTestId('cues-batch-comments-rekordbox-only')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByTestId('cues-batch-comments-to-file')).toHaveAttribute(
      'aria-checked',
      'false',
    )
    openOptions()
    fireEvent.click(screen.getByTestId('cues-batch-comments-save'))
    await waitFor(() => expect(saveComments).toHaveBeenCalledTimes(1))
    expect(saveComments.mock.calls[0][1]).toBe(false)
    await waitFor(() => expect(onCommentsSaved).toHaveBeenCalledWith(PHRASED.slice(0, 2), false))
  })

  it('shows the replaced comment in the form the moment Replace is picked, so the DJ sees what will be written before saving', async () => {
    const { saveComments, onSaveSettings, onRecomposeComments, onCommentsSaved, changeSettings } =
      setup({}, TARGETS, {}, PHRASED)
    await putPhrases()
    openOptions()
    expect(screen.getByTestId('cues-batch-comments-prepend')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(screen.getByTestId('cues-batch-comments-replace'))
    expect(onRecomposeComments).toHaveBeenCalledWith(PHRASED.slice(0, 2), 'replace')
    expect(onSaveSettings).toHaveBeenCalledWith({ commentsReplace: true })
    changeSettings({ commentsReplace: true })
    fireEvent.click(screen.getByTestId('cues-batch-comments-save'))
    await waitFor(() => expect(saveComments).toHaveBeenCalledTimes(1))
    expect(saveComments.mock.calls[0][0].map((i) => i.mode)).toEqual(['replace', 'replace'])
    await waitFor(() =>
      expect(onCommentsSaved).toHaveBeenCalledWith(
        [{ ...PHRASED[0], after: '2 - 8' }, PHRASED[1]],
        true,
      ),
    )
  })

  it('puts the phrases replacing the comment when Replace is remembered, so the next batch keeps the choice', async () => {
    const { onPhrases, changeSettings } = setup({}, TARGETS, {}, PHRASED)
    changeSettings({ commentsReplace: true })
    fireEvent.click(screen.getByTestId('cues-batch-phrases'))
    expect(onPhrases).toHaveBeenCalledExactlyOnceWith('replace')
  })

  it('keeps the files that failed pending and says so, so the DJ can retry just those', async () => {
    const { saveComments, onCommentsSaved } = setup({}, TARGETS, {}, PHRASED)
    saveComments.mockResolvedValueOnce({ failed: ['/m/b.wav'] })
    fireEvent.click(await putPhrases())
    expect(await screen.findByTestId('cues-batch-comments-failed')).toBeInTheDocument()
    expect(screen.getByTestId('cues-batch-comments-save')).toHaveTextContent('Save 1 comment')
    expect(onCommentsSaved).toHaveBeenCalledWith([PHRASED[0]], true)
  })

  it('offers the two choices as two checked groups split by a line, so where and how read as separate questions', async () => {
    setup({}, TARGETS, {}, PHRASED)
    await putPhrases()
    const toggle = screen.getByTestId('cues-batch-comments-options')
    expect(toggle).toHaveAttribute('aria-label', 'Save options')
    openOptions()
    const groups = screen.getAllByRole('group')
    expect(groups).toHaveLength(2)
    expect(
      groups.map((g) =>
        Array.from(g.querySelectorAll('[role="menuitemradio"]')).map((el) =>
          el.getAttribute('data-testid'),
        ),
      ),
    ).toEqual([
      ['cues-batch-comments-to-file', 'cues-batch-comments-rekordbox-only'],
      ['cues-batch-comments-prepend', 'cues-batch-comments-replace'],
    ])
    expect(screen.getByTestId('cues-batch-comments-to-file')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('cues-batch-comments-to-file'), { key: 'ArrowDown' })
    expect(screen.getByTestId('cues-batch-comments-rekordbox-only')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('cues-batch-comments-rekordbox-only'), {
      key: 'Escape',
    })
    expect(screen.queryByTestId('cues-batch-comments-to-file')).toBeNull()
    expect(toggle).toHaveFocus()
  })
})

describe('Cues over several selected tracks', () => {
  // With thirteen tracks selected the DJ wants them marked the way one track is: with the
  // flow they pick, not whichever happened to be active, and saying how many it will touch.
  it('lets the flow be picked before marking the whole selection', () => {
    const { onMark, onFlow } = setup()
    fireEvent.click(screen.getByTestId('cues-batch-flow'))
    fireEvent.click(
      screen.getByRole('option', { name: i18n.t(`cueFlows.builtIn.${ONE_AT_32.id}`) }),
    )
    expect(onFlow).toHaveBeenCalledWith(ONE_AT_32.id)
    const mark = screen.getByTestId('cues-auto-mark-all')
    expect(mark).toHaveTextContent(i18n.t('editor.cues.batch.mark', { count: 2 }))
    fireEvent.click(mark)
    expect(onMark).toHaveBeenCalledTimes(1)
  })

  // Going through the tracks one by one to accept was the chore: one click accepts every
  // proposal, as cues waiting to be saved, so any of them can still be opened and adjusted.
  it('accepts every proposal of the selection at once and leaves the cues unsaved', async () => {
    const { saveRekordboxCues } = setup()
    act(() => {
      keepAutoMark('103', {
        kind: 'proposed',
        proposals: [bar(64), bar(128)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      })
      keepAutoMark('104', {
        kind: 'proposed',
        proposals: [bar(32)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      })
    })
    expect(screen.getByTestId('cues-batch-tally')).toHaveTextContent('2')
    fireEvent.click(screen.getByTestId('cues-batch-accept'))
    await waitFor(() => expect([...unsavedCueTracks()].sort()).toEqual(['103', '104']))
    expect(autoMarkOf('103')).toBeUndefined()
    expect(saveRekordboxCues).not.toHaveBeenCalled()
  })

  it('accepts only the sure proposals on request and leaves the doubtful ones to review by hand', async () => {
    setup()
    act(() => {
      keepAutoMark('103', {
        kind: 'proposed',
        proposals: [
          { ms: bar(64), sure: true, quietBars: 8 },
          { ms: bar(128), sure: false, quietBars: 1 },
        ],
      })
      keepAutoMark('104', {
        kind: 'proposed',
        proposals: [{ ms: bar(32), sure: false, quietBars: 0 }],
      })
    })
    expect(screen.getByTestId('cues-batch-confidence')).toHaveTextContent('1 sure, 2 doubtful')
    expect(screen.getByTestId('cues-batch-accept-sure')).toHaveTextContent(
      i18n.t('editor.cues.batch.acceptSure', { count: 1 }),
    )
    fireEvent.click(screen.getByTestId('cues-batch-accept-sure'))
    await waitFor(() => expect([...unsavedCueTracks()]).toEqual(['103']))
    expect(autoMarkOf('103')).toEqual({
      kind: 'proposed',
      proposals: [{ ms: bar(128), sure: false, quietBars: 1 }],
    })
  })

  it('offers no separate accept for the sure ones when every proposal is sure', () => {
    setup()
    act(() => {
      keepAutoMark('103', {
        kind: 'proposed',
        proposals: [{ ms: bar(64), sure: true, quietBars: 8 }],
      })
    })
    expect(screen.queryByTestId('cues-batch-accept-sure')).toBeNull()
    expect(screen.queryByTestId('cues-batch-confidence')).toBeNull()
  })

  it('names the accept button by the proposals it accepts', () => {
    setup()
    act(() => {
      keepAutoMark('103', {
        kind: 'proposed',
        proposals: [bar(64), bar(128)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      })
      keepAutoMark('104', {
        kind: 'proposed',
        proposals: [bar(32)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      })
    })
    expect(screen.getByTestId('cues-batch-accept')).toHaveTextContent(
      i18n.t('editor.cues.auto.accept', { count: 3 }),
    )
  })

  it('counts the tracks with nothing to accept apart, so the DJ knows which ones need a look', () => {
    setup()
    act(() => {
      keepAutoMark('103', { kind: 'marked' })
      keepAutoMark('104', { kind: 'unanalysed' })
    })
    const tally = screen.getByTestId('cues-batch-tally')
    expect(tally).toHaveTextContent(i18n.t('trackList.autoMark.marked'))
    expect(tally).toHaveTextContent(i18n.t('trackList.autoMark.unanalysed'))
    expect(screen.queryByTestId('cues-batch-accept')).toBeNull()
  })

  it('shows in the list the tracks of the tally line pressed, so the DJ goes straight to the ones that need a look', () => {
    const { onShowMarked } = setup()
    act(() => {
      keepAutoMark('103', { kind: 'marked' })
      keepAutoMark('104', { kind: 'unanalysed' })
    })
    fireEvent.click(screen.getByTestId('cues-batch-tally-unanalysed'))
    expect(onShowMarked).toHaveBeenCalledTimes(1)
    expect(onShowMarked).toHaveBeenCalledWith('unanalysed')
    fireEvent.click(screen.getByTestId('cues-batch-tally-marked'))
    expect(onShowMarked).toHaveBeenLastCalledWith('marked')
  })

  it('draws no line for a kind with no tracks, so there is no button that shows an empty list', () => {
    setup()
    act(() => {
      keepAutoMark('103', { kind: 'marked' })
    })
    expect(screen.getByTestId('cues-batch-tally-marked')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-batch-tally-proposed')).toBeNull()
    expect(screen.queryByTestId('cues-batch-tally-none')).toBeNull()
    expect(screen.queryByTestId('cues-batch-tally-unanalysed')).toBeNull()
  })

  it('throws the proposals away on Descartar without placing anything', () => {
    setup()
    act(() =>
      keepAutoMark('103', {
        kind: 'proposed',
        proposals: [bar(64)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      }),
    )
    fireEvent.click(screen.getByTestId('cues-batch-discard'))
    expect(autoMarkOf('103')).toBeUndefined()
    expect([...unsavedCueTracks()]).toEqual([])
  })

  // Saving from here writes the selection's cues and nothing else: an unsaved draft on a
  // track the DJ did not select is theirs to save from that track.
  it('saves the unsaved cues of the selected tracks only', async () => {
    const { saveRekordboxCues } = setup()
    const draft = (id: string) =>
      keepDraft(
        id,
        cueDraftKey(id, 'f0', null),
        startDraft([{ ms: bar(64), kind: 0, color: null }], 'mine'),
        {
          path: `/m/${id}.wav`,
          label: id,
          fingerprint: 'f0',
        },
      )
    act(() => {
      draft('103')
      draft('999')
    })
    const save = screen.getByTestId('cues-batch-save')
    expect(save).toHaveTextContent(i18n.t('editor.cues.saveAll', { count: 1 }))
    fireEvent.click(save)
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(saveRekordboxCues.mock.calls[0][0].map((r) => r.contentId)).toEqual(['103'])
    await waitFor(() => expect([...unsavedCueTracks()]).toEqual(['999']))
  })

  it('forgets every saved draft with one notification, so saving thousands of tracks does not repaint the app once per track', async () => {
    const { saveRekordboxCues } = setup()
    const draft = (id: string) =>
      keepDraft(
        id,
        cueDraftKey(id, 'f0', null),
        startDraft([{ ms: bar(64), kind: 0, color: null }], 'mine'),
        { path: `/m/${id}.wav`, label: id, fingerprint: 'f0' },
      )
    act(() => {
      draft('103')
      draft('104')
    })
    const listener = vi.fn<() => void>()
    const stop = subscribeCueDrafts(listener)
    fireEvent.click(screen.getByTestId('cues-batch-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    await waitFor(() => expect([...unsavedCueTracks()]).toEqual([]))
    stop()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('teaches Auto from the marks of the tracks it saved, and only once they are saved', async () => {
    recordCueEdits.mockClear()
    const { saveRekordboxCues } = setup()
    const marked = startDraft([{ ms: bar(64), kind: 0, color: null }], 'mine')
    act(() => {
      keepDraft('103', cueDraftKey('103', 'f0', null), marked, {
        path: '/m/103.wav',
        label: '103',
        fingerprint: 'f0',
      })
    })
    saveRekordboxCues.mockRejectedValueOnce(new Error('closed'))
    fireEvent.click(screen.getByTestId('cues-batch-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(recordCueEdits).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('cues-batch-save'))
    await waitFor(() => expect(recordCueEdits).toHaveBeenCalledTimes(1))
    expect(recordCueEdits.mock.calls[0][1]).toEqual([{ contentId: '103', draft: marked }])
  })

  // Marking thirteen tracks from rekordbox's list reaches Traktor and Engine DJ too, so the
  // DJ sees beforehand how many tracks each program gets and saves them all at once.
  it('counts what each program gets and saves the flow in all of them', async () => {
    const T1 = 'traktor:M/:m/:a.wav'
    const T2 = 'traktor:M/:m/:b.wav'
    const { saveRekordboxCues } = setup({
      '/m/a.wav': { traktor: T1 },
      '/m/b.wav': { traktor: T2, engine: 'engine:2' },
    })
    act(() => {
      keepAutoMark('103', {
        kind: 'proposed',
        proposals: [bar(64)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      })
      keepAutoMark('104', {
        kind: 'proposed',
        proposals: [bar(96)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      })
    })
    fireEvent.click(screen.getByTestId('cues-batch-accept'))
    const twins = await screen.findByTestId('cues-batch-twins')
    await waitFor(() =>
      expect(screen.getByTestId('cues-batch-twin-traktor')).toHaveTextContent('2'),
    )
    expect(screen.getByTestId('cues-batch-twin-rekordbox')).toHaveTextContent('2')
    expect(screen.getByTestId('cues-batch-twin-engine')).toHaveTextContent('1')
    expect(twins).toHaveTextContent('Engine DJ')
    expect(screen.getAllByTestId(/^cues-batch-twin-/).map((row) => row.dataset.testid)).toEqual([
      'cues-batch-twin-rekordbox',
      'cues-batch-twin-traktor',
      'cues-batch-twin-engine',
    ])
    const save = screen.getByTestId('cues-batch-save')
    expect(save).toHaveTextContent(i18n.t('editor.cues.saveAllMixed', { count: 2 }))
    fireEvent.click(save)
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(saveRekordboxCues.mock.calls[0][0].map((r) => r.contentId).sort()).toEqual(
      ['103', '104', 'engine:2', T1, T2].sort(),
    )
  })

  it('asks to close each program the batch save reaches before saving, once per Save', async () => {
    const T1 = 'traktor:M/:m/:a.wav'
    const T2 = 'traktor:M/:m/:b.wav'
    const { askToApply, calls } = setup({
      '/m/a.wav': { traktor: T1 },
      '/m/b.wav': { traktor: T2, engine: 'engine:2' },
    })
    act(() => {
      keepAutoMark('103', {
        kind: 'proposed',
        proposals: [bar(64)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      })
      keepAutoMark('104', {
        kind: 'proposed',
        proposals: [bar(96)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      })
    })
    fireEvent.click(screen.getByTestId('cues-batch-accept'))
    await screen.findByTestId('cues-batch-twins')
    await waitFor(() => expect(screen.getByTestId('cues-batch-twin-engine')).toHaveTextContent('1'))
    fireEvent.click(screen.getByTestId('cues-batch-save'))
    await waitFor(() => expect(calls).toEqual(['askToApply', 'save']))
    expect(askToApply).toHaveBeenCalledOnce()
    expect([...askToApply.mock.calls[0][0]].sort()).toEqual(['engine', 'rekordbox', 'traktor'])
  })

  it('adjusts the grids of the selection from the same panel that marks its cues', () => {
    const { onShowBadGrid } = setup()
    expect(screen.getByTestId('grid-batch-adjust')).toHaveTextContent(
      i18n.t('editor.cues.gridBatch.adjust', { count: 1 }),
    )
    fireEvent.click(screen.getByTestId('grid-batch-show'))
    expect(onShowBadGrid).toHaveBeenCalled()
  })

  it('counts the Serato tracks of the selection among what each program gets', async () => {
    const S = 'serato:/m/a.wav'
    const T1 = 'traktor:M/:m/:a.wav'
    setup({ '/m/a.wav': { traktor: T1 } }, [{ contentId: S, path: '/m/a.wav', label: 'Maniac' }])
    act(() =>
      keepAutoMark(S, {
        kind: 'proposed',
        proposals: [bar(64)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      }),
    )
    fireEvent.click(screen.getByTestId('cues-batch-accept'))
    await waitFor(() =>
      expect(screen.getByTestId('cues-batch-twin-traktor')).toHaveTextContent('1'),
    )
    expect(screen.getByTestId('cues-batch-twin-serato')).toHaveTextContent('1')
    expect(screen.getAllByTestId(/^cues-batch-twin-/).map((row) => row.dataset.testid)).toEqual([
      'cues-batch-twin-traktor',
      'cues-batch-twin-serato',
    ])
    expect(screen.getByTestId('cues-batch-twins')).toHaveTextContent('Serato')
  })

  it('counts and saves the same files in Serato, until the DJ takes Serato out of the flows', async () => {
    const S = 'serato:/m/a.wav'
    const { saveRekordboxCues, changeSettings } = setup({ '/m/a.wav': { serato: S } }, [TARGETS[0]])
    act(() =>
      keepAutoMark('103', {
        kind: 'proposed',
        proposals: [bar(64)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      }),
    )
    fireEvent.click(screen.getByTestId('cues-batch-accept'))
    await waitFor(() => expect(screen.getByTestId('cues-batch-twin-serato')).toHaveTextContent('1'))
    changeSettings({ cueFlowToSerato: false })
    await waitFor(() => expect(screen.queryByTestId('cues-batch-twin-serato')).toBeNull())
    changeSettings({})
    await waitFor(() => expect(screen.getByTestId('cues-batch-twin-serato')).toHaveTextContent('1'))
    fireEvent.click(screen.getByTestId('cues-batch-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(saveRekordboxCues.mock.calls[0][0].map((r) => r.contentId)).toEqual(['103', S])
  })

  // Saving works the other programs' cues out again with the flows as they are now, so the
  // count must too: a count kept from the old rules promises tracks the save won't reach.
  it('counts again with the new rules when the DJ changes the flow', async () => {
    const T = 'traktor:M/:m/:a.wav'
    const full = HOT_KINDS.map((kind, i) => ({ id: `r${i}`, ms: bar(150 + i), kind, color: 1 }))
    const { saveRekordboxCues, changeSettings } = setup(
      { '/m/a.wav': { rekordbox: '7' } },
      [{ contentId: T, path: '/m/a.wav', label: 'Maniac' }],
      { '7': full },
    )
    act(() =>
      keepAutoMark(T, {
        kind: 'proposed',
        proposals: [bar(64)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      }),
    )
    fireEvent.click(screen.getByTestId('cues-batch-accept'))
    await waitFor(() =>
      expect(screen.getByTestId('cues-batch-twin-rekordbox')).toHaveTextContent('1'),
    )
    changeSettings({ cueFlows: [{ ...MY_FLOW, markPoint: false }, ONE_AT_32] })
    await waitFor(() => expect(screen.queryByTestId('cues-batch-twin-rekordbox')).toBeNull())
    fireEvent.click(screen.getByTestId('cues-batch-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(saveRekordboxCues.mock.calls[0][0].map((r) => r.contentId)).toEqual([T])
  })

  it('counts again when the cues stop counting as placed by the flow, so the count matches what saving writes', async () => {
    const T = 'traktor:M/:m/:a.wav'
    const { saveRekordboxCues, changeSettings } = setup({ '/m/a.wav': { traktor: T } }, [
      TARGETS[0],
    ])
    act(() =>
      keepAutoMark('103', {
        kind: 'proposed',
        proposals: [bar(64)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      }),
    )
    fireEvent.click(screen.getByTestId('cues-batch-accept'))
    await waitFor(() =>
      expect(screen.getByTestId('cues-batch-twin-traktor')).toHaveTextContent('1'),
    )
    const [{ path, label, draft }] = keptDrafts()
    act(() =>
      keepDraft(
        '103',
        cueDraftKey('103', 'f0', null),
        { ...draft, origin: {} },
        { path, label, fingerprint: 'f0' },
      ),
    )
    changeSettings({})
    await waitFor(() => expect(screen.queryByTestId('cues-batch-twin-traktor')).toBeNull())
    fireEvent.click(screen.getByTestId('cues-batch-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(saveRekordboxCues.mock.calls[0][0].map((r) => r.contentId)).toEqual(['103'])
  })

  it('says how many tracks keep their unsaved changes in the other program', async () => {
    const T1 = 'traktor:M/:m/:a.wav'
    keepDraft(
      T1,
      cueDraftKey(T1, 'f0', null),
      startDraft([{ ms: bar(8), kind: 1, color: 1 }], 'mine'),
      {
        path: '/m/a.wav',
        label: 'Maniac',
        fingerprint: 'f0',
      },
    )
    const { saveRekordboxCues } = setup({ '/m/a.wav': { traktor: T1 } })
    act(() =>
      keepAutoMark('103', {
        kind: 'proposed',
        proposals: [bar(64)].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      }),
    )
    fireEvent.click(screen.getByTestId('cues-batch-accept'))
    const traktor = await screen.findByTestId('cues-batch-twin-traktor')
    expect(traktor).toHaveTextContent(i18n.t('editor.cues.batch.twinsUnsaved', { count: 1 }))
    fireEvent.click(screen.getByTestId('cues-batch-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(saveRekordboxCues.mock.calls[0][0].map((r) => r.contentId)).toEqual(['103'])
  })
  it('holds only the Traktor tracks back while the Traktor collection is not confirmed', async () => {
    const T1 = 'traktor:M/:m/:a.wav'
    const targets = [
      { contentId: '103', path: '/m/a.wav', label: 'Maniac' },
      { contentId: T1, path: '/m/b.wav', label: 'Summer Sky' },
      { contentId: 'engine:2', path: '/m/c.wav', label: 'Tengo' },
    ]
    for (const t of targets)
      keepDraft(
        t.contentId,
        cueDraftKey(t.contentId, 'f0', null),
        startDraft([{ ms: bar(8), kind: 1, color: 1 }], 'mine'),
        { path: t.path, label: t.label, fingerprint: 'f0' },
      )
    const saveRekordboxCues = vi.fn<Api['cues']['save']>(async () => {})
    installApi({
      cues: {
        twins: vi.fn<Api['cues']['twins']>(async () => ({})),
        trackCues: vi.fn<Api['cues']['trackCues']>(async (id) => ({
          ...READ,
          contentId: id,
        })),
        liveCues: vi.fn<Api['cues']['liveCues']>(async (ids) =>
          Object.fromEntries(
            ids.map((id) => [id, { cues: READ.cues, fingerprint: READ.fingerprint }]),
          ),
        ),
        queued: vi.fn<Api['cues']['queued']>(async () => null),
        save: saveRekordboxCues,
      },
      traktorCanSave: async () => false,
    })
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SettingsProvider settings={{ cueFlows: KEPT, activeCueFlow: 'mine' }}>
          <CuesBatchSection
            targets={targets}
            onMark={vi.fn()}
            onFlow={vi.fn()}
            gridCheckOf={() => ON_BEATS}
            onShowMarked={vi.fn()}
            onShowBadGrid={vi.fn()}
            onOpen={vi.fn()}
            onPhrases={vi.fn()}
            onRestoreComments={vi.fn()}
            onRecomposeComments={vi.fn()}
            onCommentsSaved={vi.fn()}
            onSaveSettings={vi.fn()}
          />
        </SettingsProvider>
      </QueryClientProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('cues-batch-save')).toHaveTextContent(
        i18n.t('editor.cues.saveAllBoth', { count: 2 }),
      ),
    )
    fireEvent.click(screen.getByTestId('cues-batch-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    expect(saveRekordboxCues.mock.calls[0][0].map((r) => r.contentId).sort()).toEqual([
      '103',
      'engine:2',
    ])
  })
})

describe('Cues over several selected tracks of the programs Surco saves cues to', () => {
  const VDJ = [
    { contentId: 'virtualdj:/m/a.wav', path: '/m/a.wav', label: 'Maniac' },
    { contentId: 'virtualdj:/m/b.wav', path: '/m/b.wav', label: 'Summer Sky' },
  ]

  it('leaves Auto mark enabled on VirtualDJ rows, now that Surco saves their cues', () => {
    const { onMark } = setup({}, VDJ)
    const mark = screen.getByTestId('cues-auto-mark-all')
    expect(mark).toBeEnabled()
    fireEvent.click(mark)
    expect(onMark).toHaveBeenCalled()
  })

  it('leaves Auto mark enabled for a selection that mixes VirtualDJ and rekordbox rows', () => {
    setup({}, [TARGETS[0], VDJ[0]])
    expect(screen.getByTestId('cues-auto-mark-all')).toBeEnabled()
  })

  it('leaves Auto mark enabled on Serato rows, which Surco saves', () => {
    setup({}, [
      { contentId: 'serato:/m/a.mp3', path: '/m/a.mp3', label: 'A' },
      { contentId: 'serato:/m/b.mp3', path: '/m/b.mp3', label: 'B' },
    ])
    expect(screen.getByTestId('cues-auto-mark-all')).toBeEnabled()
  })
})

describe('Clearing the cues of several selected tracks', () => {
  const hot = (id: string, ms: number, kind: number) => ({ id, ms, kind, color: null })
  const loop = (id: string, ms: number) => ({ ...hot(id, ms, 1), loop: true })
  const CUES = {
    '103': [hot('a', 1000, 1), hot('b', 2000, 2), hot('c', 3000, 0), loop('l', 4000)],
    '104': [hot('d', 1000, 1)],
  }

  it('leaves the cleared tracks as unsaved drafts the Save button counts, so nothing is written until the DJ saves', async () => {
    const { saveRekordboxCues } = setup({}, TARGETS, CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    const save = await screen.findByTestId('cues-batch-save')
    expect(save).toHaveTextContent(i18n.t('editor.cues.saveAll', { count: 2 }))
    expect(saveRekordboxCues).not.toHaveBeenCalled()
  })

  it('puts Save beside Discard and above the grid block, so the DJ sees it saves the cleared cues and not the grid or a conversion', async () => {
    setup({}, TARGETS, CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    const discard = await screen.findByTestId('cues-batch-clear-discard')
    const save = screen.getByTestId('cues-batch-save')
    expect(discard.parentElement).toBe(save.parentElement)
    expect(
      save.compareDocumentPosition(screen.getByTestId('grid-batch')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('dims the clear button and drops its hover while it is off, so a blocked click does not look available', async () => {
    setup({}, TARGETS, CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    const clear = screen.getByTestId('cues-batch-clear')
    expect(clear).toBeDisabled()
    expect(clear).toHaveClass('disabled:opacity-40')
    expect(clear).toHaveClass('disabled:hover:text-fg-dim')
    await screen.findByTestId('cues-batch-cleared')
  })

  it('turns the clear button off while it reads the tracks, so a second click does not read them twice', async () => {
    const { saveRekordboxCues } = setup({}, TARGETS, CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    expect(screen.getByTestId('cues-batch-clear')).toBeDisabled()
    await screen.findByTestId('cues-batch-cleared')
    expect(saveRekordboxCues).not.toHaveBeenCalled()
  })

  it('tells what goes and what stays, so the DJ knows loops survive before saving', async () => {
    setup({}, TARGETS, CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    expect(await screen.findByTestId('cues-batch-cleared-hot')).toHaveTextContent(
      i18n.t('editor.cues.batch.clearedHot', { count: 3 }),
    )
    expect(screen.getByTestId('cues-batch-cleared-calls')).toHaveTextContent(
      i18n.t('editor.cues.batch.clearedCalls', { count: 1 }),
    )
    expect(screen.getByTestId('cues-batch-cleared-loops')).toHaveTextContent(
      i18n.t('editor.cues.batch.clearedLoops', { count: 1 }),
    )
  })

  it('lists only the counts that are not zero, so the tally does not say 0 CALLs', async () => {
    setup({}, [TARGETS[1]], CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    await screen.findByTestId('cues-batch-cleared-hot')
    expect(screen.queryByTestId('cues-batch-cleared-calls')).toBeNull()
    expect(screen.queryByTestId('cues-batch-cleared-loops')).toBeNull()
    expect(screen.queryByTestId('cues-batch-cleared-unsaved')).toBeNull()
  })

  it('warns about the tracks with unsaved changes it did not touch, so the DJ does not think they were cleared', async () => {
    setup({}, TARGETS, CUES)
    act(() => {
      keepDraft(
        '103',
        cueDraftKey('103', 'f0', null),
        startDraft([{ ms: bar(64), kind: 1, color: null }], 'mine'),
        { path: '/m/103.wav', label: '103', fingerprint: 'f0' },
      )
    })
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    const row = await screen.findByTestId('cues-batch-cleared-unsaved')
    expect(row).toHaveTextContent(i18n.t('editor.cues.batch.clearedUnsaved', { count: 1 }))
  })

  it('brings back nothing to save when the DJ discards, so a misclick on Clear costs nothing', async () => {
    setup({}, TARGETS, CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    fireEvent.click(await screen.findByTestId('cues-batch-clear-discard'))
    expect([...unsavedCueTracks()]).toEqual([])
    expect(screen.queryByTestId('cues-batch-save')).toBeNull()
    expect(screen.queryByTestId('cues-batch-cleared')).toBeNull()
  })

  it('drops every cleared draft with one notification when the DJ discards, so a big discard does not repaint the app once per track', async () => {
    setup({}, TARGETS, CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    const discard = await screen.findByTestId('cues-batch-clear-discard')
    const listener = vi.fn<() => void>()
    const stop = subscribeCueDrafts(listener)
    fireEvent.click(discard)
    stop()
    expect([...unsavedCueTracks()]).toEqual([])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('offers no discard when every track was left alone, since there is nothing to bring back', async () => {
    setup({}, [TARGETS[0]], CUES)
    act(() => {
      keepDraft(
        '103',
        cueDraftKey('103', 'f0', null),
        startDraft([{ ms: bar(64), kind: 1, color: null }], 'mine'),
        { path: '/m/103.wav', label: '103', fingerprint: 'f0' },
      )
    })
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    await screen.findByTestId('cues-batch-cleared-unsaved')
    expect(screen.queryByTestId('cues-batch-clear-discard')).toBeNull()
  })

  it('hides the tally once the cleared tracks are saved, so it does not describe work already done', async () => {
    const { saveRekordboxCues } = setup({}, TARGETS, CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    await screen.findByTestId('cues-batch-cleared')
    fireEvent.click(screen.getByTestId('cues-batch-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByTestId('cues-batch-cleared')).toBeNull())
  })

  it('drops the tally and Discard when the selection changes, so Discard never reaches tracks it was not made for', async () => {
    const { changeTargets } = setup({}, TARGETS, CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    await screen.findByTestId('cues-batch-clear-discard')
    changeTargets([TARGETS[0]])
    expect(screen.queryByTestId('cues-batch-cleared')).toBeNull()
    expect(screen.queryByTestId('cues-batch-clear-discard')).toBeNull()
  })

  it('never wipes the same track in another program, so one Clear click stays inside the selected track', async () => {
    const T1 = 'traktor:M/:m/:a.wav'
    const { saveRekordboxCues } = setup({ '/m/a.wav': { traktor: T1 } }, [TARGETS[0]], CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    await screen.findByTestId('cues-batch-cleared')
    fireEvent.click(await screen.findByTestId('cues-batch-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalledTimes(1))
    const reqs = saveRekordboxCues.mock.calls[0][0]
    expect(reqs.map((r) => r.contentId)).toEqual(['103'])
    expect(reqs[0].wanted).toEqual([{ id: 'l', ms: 4000, kind: 1, color: null }])
  })

  it('turns Clear off while its tally is showing, so a second click cannot replace it with a misleading one', async () => {
    setup({}, TARGETS, CUES)
    fireEvent.click(screen.getByTestId('cues-batch-clear'))
    await screen.findByTestId('cues-batch-clear-discard')
    expect(screen.getByTestId('cues-batch-clear')).toBeDisabled()
    fireEvent.click(screen.getByTestId('cues-batch-clear-discard'))
    expect(screen.getByTestId('cues-batch-clear')).not.toBeDisabled()
  })
})
