// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { emptyMetadata } from '../../../shared/metadata'
import type { Settings } from '../../../shared/types'
import { installApi } from '../test/api'
import type { TrackItem } from '../types'
import '../i18n'
import { useConfirmFlows } from './useConfirmFlows'
import type { ConfirmModal } from './useOverlays'

function track(id: string, over: Partial<TrackItem> = {}): TrackItem {
  return {
    id,
    inputPath: `/${id}.wav`,
    fileName: `Artist - ${id}.wav`,
    listLabel: id,
    query: '',
    status: 'idle',
    meta: { ...emptyMetadata(), title: id, artist: 'A' },
    ...over,
  }
}

function setup(
  allTracks: TrackItem[],
  extra: {
    onOldMusicCopyRemoved?: ReturnType<typeof vi.fn<() => void>>
    reportOldCopyRemoveFailure?: ReturnType<typeof vi.fn<(mismatch: boolean) => void>>
    updateTrack?: ReturnType<typeof vi.fn<(id: string, patch: Partial<TrackItem>) => void>>
    removeTrack?: ReturnType<typeof vi.fn<(id: string) => void>>
    reportTrashFailure?: ReturnType<typeof vi.fn<(fileName: string) => void>>
    settings?: Settings | null
  } = {},
) {
  const opened: ConfirmModal[] = []
  const removeTrack = extra.removeTrack ?? vi.fn()
  const { result } = renderHook(() =>
    useConfirmFlows({
      settings: extra.settings ?? null,
      removeTrack,
      updateTrack: extra.updateTrack ?? vi.fn(),
      emptyTracks: vi.fn(),
      deriveTracks: vi.fn(),
      processAll: vi.fn(),
      openConfirm: (c) => opened.push(c),
      reportTrashFailure: extra.reportTrashFailure ?? vi.fn(),
      onOldMusicCopyRemoved: extra.onOldMusicCopyRemoved ?? vi.fn(),
      reportOldCopyRemoveFailure: extra.reportOldCopyRemoveFailure ?? vi.fn(),
      tracksRef: { current: allTracks },
    }),
  )
  return { flows: result.current, opened, removeTrack }
}

// A track carries staged edits when its live state has diverged from what the file on
// disk holds — the same test sessionEdits uses to decide what is worth saving across a
// crash. diskSignature is the snapshot taken when the file was read.
function edited(id: string): TrackItem {
  return track(id, { diskSignature: 'what-the-file-had', meta: { ...emptyMetadata(), title: id } })
}

// Removing is not undoable: useMetaUndo filters to rows that still exist and never
// resurrects a deleted one. The dialog was asked for by COUNT — one row went straight
// through — so a single track carrying an hour of tagging was discarded on a stray click
// of a hover-revealed ✕, with nothing to say it had anything on it. Asking by CONTENT
// keeps the ordinary gesture free (which is what stops the dialog being trained away)
// and stops exactly the case that loses work.
describe('useConfirmFlows removing tracks from the list', () => {
  it('removes a single untouched track without asking', () => {
    const t = track('a')
    const { flows, opened, removeTrack } = setup([t])

    flows.askRemoveFromList([t])

    expect(opened).toHaveLength(0)
    expect(removeTrack).toHaveBeenCalledWith('a')
  })

  it('asks before discarding a single track that carries staged edits', () => {
    const t = edited('a')
    const { flows, opened, removeTrack } = setup([t])

    flows.askRemoveFromList([t])

    expect(opened).toHaveLength(1)
    expect(removeTrack).not.toHaveBeenCalled()
    opened[0].onConfirm?.()
    expect(removeTrack).toHaveBeenCalledWith('a')
  })

  // The strings were written for the many-rows case only. Now that one row can raise the
  // dialog too, a fixed plural would greet it with "Remove 1 tracks from the list?".
  it('words the single-track dialog as one track', () => {
    const t = edited('a')
    const { flows, opened } = setup([t])

    flows.askRemoveFromList([t])

    expect(opened[0].title).not.toContain('1 tracks')
    expect(opened[0].message).not.toContain('1 tracks')
  })

  // The expanded case keeps asking whatever the rows carry: one click on a hover-revealed
  // ✕ acting on dozens of rows is worth confirming on its own.
  it('still asks for a multi-row removal with nothing staged', () => {
    const rows = [track('a'), track('b')]
    const { flows, opened } = setup(rows)

    flows.askRemoveFromList(rows)

    expect(opened).toHaveLength(1)
  })

  it('does not ask when a converted track matches what is on disk', () => {
    // Converted and unchanged since: the signature matches, so there is nothing staged
    // to lose and the ✕ stays a one-click gesture.
    const t = track('a', { diskSignature: undefined })
    const { flows, opened } = setup([t])

    flows.askRemoveFromList([t])

    expect(opened).toHaveLength(0)
  })
})

describe('useConfirmFlows scope wording', () => {
  // The toolbar's clear acts on the filtered-visible rows while the palette's acts on
  // everything — two buttons that read the same but sweep different sets. The dialog is
  // the last chance to say which: with a filter active it must state that hidden tracks
  // survive, so the user can predict what the list looks like after confirming.
  it('says hidden tracks survive when clearing a filtered view', () => {
    const all = [track('a'), track('b'), track('c')]
    const { flows, opened } = setup(all)
    flows.askClearAll(all.slice(0, 2))
    expect(opened[0].message).toContain('visible')
    expect(opened[0].message).toContain('2')
  })

  it('keeps the plain wording when clearing the whole list', () => {
    const all = [track('a'), track('b')]
    const { flows, opened } = setup(all)
    flows.askClearAll(all)
    expect(opened[0].message).not.toContain('visible')
  })

  // Fill-all overwrites tags across the visible set; when a filter hides part of the
  // list the dialog must scope its promise to the visible rows only.
  it('scopes the fill-all wording to the visible rows under a filter', () => {
    const all = [track('a'), track('b'), track('c')]
    const { flows, opened } = setup(all)
    flows.askFillAll(all.slice(0, 2))
    expect(opened[0].message).toContain('visible')
  })

  it('keeps the plain fill-all wording without a filter', () => {
    const all = [track('a'), track('b')]
    const { flows, opened } = setup(all)
    flows.askFillAll(all)
    expect(opened[0].message).not.toContain('visible')
  })
})

describe('useConfirmFlows clean up previous files', () => {
  const stale = { persistentId: 'OLDCOPY123456789', label: 'Djmofly - Save My Love (26 Rmx)' }

  // One link replaced three, so the one dialog must say everything it is about to move:
  // a single "clean up" that silently took the old Apple Music entry along with the
  // original would delete more than the user agreed to. Nothing moves before the answer.
  it('lists the original, the replaced file and the old library copy before touching any', async () => {
    const trashFile = vi.fn<Api['trashFile']>().mockResolvedValue(undefined)
    const deleteAppleMusic = vi
      .fn<Api['deleteAppleMusic']>()
      .mockResolvedValue({ outcome: 'deleted' })
    installApi({ trashFile, deleteAppleMusic, keepsTrash: vi.fn().mockResolvedValue(true) })
    const a = track('a', { status: 'done', replacesPath: '/old/a.mp3' })
    const { flows, opened } = setup([a])
    await flows.askCleanUp(a, {
      originalPath: '/a.wav',
      superseded: [{ trackId: 'a', path: '/old/a.mp3' }],
      staleMusicCopy: stale,
    })
    expect(opened[0].destructive).toBe(true)
    expect(opened[0].items).toHaveLength(3)
    expect(opened[0].items?.join('\n')).toContain('a.wav')
    expect(opened[0].items?.join('\n')).toContain('a.mp3')
    expect(opened[0].items?.join('\n')).toContain('Djmofly - Save My Love (26 Rmx)')
    expect(trashFile).not.toHaveBeenCalled()
    expect(deleteAppleMusic).not.toHaveBeenCalled()
  })

  // Confirming runs the same three actions the separate links ran, and each row learns
  // its file is gone so the link retires instead of offering a file already in the Trash.
  it('runs every listed removal and marks the rows once confirmed', async () => {
    const trashFile = vi.fn<Api['trashFile']>().mockResolvedValue(undefined)
    const deleteAppleMusic = vi
      .fn<Api['deleteAppleMusic']>()
      .mockResolvedValue({ outcome: 'deleted' })
    installApi({ trashFile, deleteAppleMusic, keepsTrash: vi.fn().mockResolvedValue(true) })
    const a = track('a', { status: 'done', replacesPath: '/old/a.mp3' })
    const updateTrack = vi.fn()
    const onOldMusicCopyRemoved = vi.fn()
    const { flows, opened } = setup([a], { updateTrack, onOldMusicCopyRemoved })
    await flows.askCleanUp(a, {
      originalPath: '/a.wav',
      superseded: [{ trackId: 'a', path: '/old/a.mp3' }],
      staleMusicCopy: stale,
    })
    opened[0].onConfirm()
    await waitFor(() => expect(updateTrack).toHaveBeenCalledWith('a', { originalTrashed: true }))
    await waitFor(() => expect(updateTrack).toHaveBeenCalledWith('a', { supersededTrashed: true }))
    expect(deleteAppleMusic).toHaveBeenCalledWith(stale.persistentId, stale.label)
    expect(trashFile).toHaveBeenCalledWith('/a.wav')
    expect(trashFile).toHaveBeenCalledWith('/old/a.mp3')
    expect(onOldMusicCopyRemoved).toHaveBeenCalled()
  })

  // A multi-select replacement strands one file per track; each row is marked by its own
  // file so a partial failure leaves the rest of the offer standing.
  it('marks each replaced file on the row that replaced it', async () => {
    installApi({
      trashFile: vi.fn<Api['trashFile']>().mockResolvedValue(undefined),
      keepsTrash: vi.fn().mockResolvedValue(true),
    })
    const a = track('a', { status: 'done', replacesPath: '/old/a.mp3' })
    const b = track('b', { status: 'done', replacesPath: '/old/b.mp3' })
    const updateTrack = vi.fn()
    const { flows, opened } = setup([a, b], { updateTrack })
    await flows.askCleanUp(a, {
      originalPath: null,
      superseded: [
        { trackId: 'a', path: '/old/a.mp3' },
        { trackId: 'b', path: '/old/b.mp3' },
      ],
      staleMusicCopy: null,
    })
    opened[0].onConfirm()
    await waitFor(() => expect(updateTrack).toHaveBeenCalledWith('b', { supersededTrashed: true }))
    expect(updateTrack).toHaveBeenCalledWith('a', { supersededTrashed: true })
  })

  // Measured 15/09 on the user's NAS (smbfs, no .Trashes): a file was lost while the
  // dialog promised it was recoverable. Any file on such a volume drops the promise.
  it('warns that the deletion may be permanent when a file sits on a volume without a Trash', async () => {
    installApi({
      keepsTrash: vi.fn(async (path: string) => path !== '/Volumes/NAS/old/a.mp3'),
    })
    const a = track('a', { status: 'done', replacesPath: '/Volumes/NAS/old/a.mp3' })
    const { flows, opened } = setup([a])
    await flows.askCleanUp(a, {
      originalPath: '/a.wav',
      superseded: [{ trackId: 'a', path: '/Volumes/NAS/old/a.mp3' }],
      staleMusicCopy: null,
    })
    expect(opened[0].message).toContain('network volume')
  })

  // Windows hands the renderer backslash paths; splitting on '/' alone listed the whole
  // route as the file's name in the dialog and in the failure toast.
  it('names Windows files by their base name', async () => {
    installApi({
      trashFile: vi.fn<Api['trashFile']>().mockRejectedValue(new Error('EPERM')),
      keepsTrash: vi.fn().mockResolvedValue(true),
    })
    const reportTrashFailure = vi.fn()
    const a = track('a', { status: 'done' })
    const { flows, opened } = setup([a], { reportTrashFailure })
    await flows.askCleanUp(a, {
      originalPath: 'C:\\Music\\a.wav',
      superseded: [],
      staleMusicCopy: null,
    })
    expect(opened[0].items?.[0]).toContain('a.wav')
    expect(opened[0].items?.[0]).not.toContain('Music')
    opened[0].onConfirm()
    await waitFor(() => expect(reportTrashFailure).toHaveBeenCalledWith('a.wav'))
  })

  // The user confirmed a destructive dialog; a silent failure would read as done.
  it('reports a file that could not be moved out loud', async () => {
    installApi({
      trashFile: vi.fn<Api['trashFile']>().mockRejectedValue(new Error('EPERM')),
      keepsTrash: vi.fn().mockResolvedValue(true),
    })
    const reportTrashFailure = vi.fn()
    const a = track('a', { status: 'done' })
    const { flows, opened } = setup([a], { reportTrashFailure })
    await flows.askCleanUp(a, { originalPath: '/a.wav', superseded: [], staleMusicCopy: null })
    opened[0].onConfirm()
    await waitFor(() => expect(reportTrashFailure).toHaveBeenCalledWith('a.wav'))
  })

  it('reports a failed Apple Music removal out loud', async () => {
    installApi({
      deleteAppleMusic: vi
        .fn<Api['deleteAppleMusic']>()
        .mockRejectedValue(new Error('osascript failed')),
    })
    const reportOldCopyRemoveFailure = vi.fn()
    const a = track('a')
    const { flows, opened } = setup([], { reportOldCopyRemoveFailure })
    await flows.askCleanUp(a, { originalPath: null, superseded: [], staleMusicCopy: stale })
    opened[0].onConfirm()
    await waitFor(() => expect(reportOldCopyRemoveFailure).toHaveBeenCalledWith(false))
  })

  // The delete script refused because the live Music track no longer matches the label
  // the user confirmed: nothing was deleted, and App must refresh the poisoned snapshot.
  it('reports a refused mismatched removal as a mismatch', async () => {
    installApi({
      deleteAppleMusic: vi
        .fn<Api['deleteAppleMusic']>()
        .mockRejectedValue(
          new Error("Error invoking remote method 'applemusic:delete': applemusic-delete-mismatch"),
        ),
    })
    const reportOldCopyRemoveFailure = vi.fn()
    const a = track('a')
    const { flows, opened } = setup([], { reportOldCopyRemoveFailure })
    await flows.askCleanUp(a, { originalPath: null, superseded: [], staleMusicCopy: stale })
    opened[0].onConfirm()
    await waitFor(() => expect(reportOldCopyRemoveFailure).toHaveBeenCalledWith(true))
  })

  // With Music's "copy files to the Media folder" off, the old entry's file can BE the
  // original listed beside it. Removing the entry already sent that file to the Trash,
  // so trashing it again would fail on a missing file and report a false error.
  it('does not trash the original again when the old library copy was that same file', async () => {
    const trashFile = vi.fn<Api['trashFile']>().mockResolvedValue(undefined)
    installApi({
      trashFile,
      keepsTrash: vi.fn().mockResolvedValue(true),
      deleteAppleMusic: vi
        .fn<Api['deleteAppleMusic']>()
        .mockResolvedValue({ outcome: 'deleted', location: '/a.wav' }),
    })
    const updateTrack = vi.fn()
    const a = track('a', { status: 'done' })
    const { flows, opened } = setup([a], { updateTrack })
    await flows.askCleanUp(a, {
      originalPath: '/a.wav',
      superseded: [],
      staleMusicCopy: stale,
    })
    opened[0].onConfirm()
    await waitFor(() => expect(updateTrack).toHaveBeenCalledWith('a', { originalTrashed: true }))
    expect(trashFile).not.toHaveBeenCalled()
  })
})

describe('useConfirmFlows single-track overwrite', () => {
  // Overwriting one source in place is exactly as destructive as overwriting many — the
  // original is unlinked, not trashed. The batch path already confirms; the single path
  // must not fire straight into the conversion just because only one track is selected,
  // or the same irreversible write behaves differently by selection size.
  it('confirms before an in-place single-track convert', () => {
    const { flows, opened } = setup([track('a')])
    const run = vi.fn()
    flows.askConvertOne(run, { destination: 'overwrite' })
    expect(opened[0].destructive).toBe(true)
    expect(run).not.toHaveBeenCalled()
    opened[0].onConfirm()
    expect(run).toHaveBeenCalledTimes(1)
  })

  // Every non-overwrite destination only writes new files, so a single convert there stays
  // one action with no dialog — the confirmation is reserved for the irreversible case.
  it('fires straight through for a non-overwrite single-track convert', () => {
    const { flows, opened } = setup([track('a')])
    const run = vi.fn()
    flows.askConvertOne(run, { destination: 'beside' })
    expect(opened).toHaveLength(0)
    expect(run).toHaveBeenCalledTimes(1)
  })

  // With no one-shot destination override the live setting decides, exactly as the batch
  // path resolves it — an overwrite setting must still confirm a single convert.
  it('confirms a single convert when the overwrite setting is on and no override is given', () => {
    const { flows, opened } = setup([track('a')], {
      settings: { overwriteOriginal: true } as Settings,
    })
    const run = vi.fn()
    flows.askConvertOne(run)
    expect(opened[0].destructive).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('useConfirmFlows lossy in-place re-encode', () => {
  // 'source' on an .mp3 resolves to mp3 and formatMatchesInput calls that in-place —
  // with normalize active planConversion loses copyOk and re-encodes the only copy,
  // permanently degrading it. The user asked to keep the file's format, not to have it
  // silently quality-downgraded, so this must ask before firing, exactly like overwrite.
  it('confirms a batch convert that would re-encode an mp3 in place under source with normalize on', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3' })
    const { flows, opened } = setup([mp3])
    flows.askConvertAll([mp3], 'source', {
      mode: 'peak',
      targetLufs: -14,
      truePeakDb: -1,
      peakDb: -1,
    })
    expect(opened[0].destructive).toBe(true)
  })

  // Same in-place mp3 rewrite, but nothing alters the samples: planConversion keeps
  // copyOk and just stream-copies + rewrites tags, so there is no quality loss to warn
  // about and the batch must fire straight through like any non-destructive convert.
  it('does not confirm a batch convert of an in-place mp3 under source with no filters active', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3' })
    const { flows, opened } = setup([mp3])
    flows.askConvertAll([mp3], 'source')
    expect(opened).toHaveLength(0)
  })

  // A .wav has no lossy generation to lose, so even in place with a filter running it
  // must not trip the mp3-only warning.
  it('does not confirm a batch convert of an in-place wav under source with normalize on', () => {
    const wav = track('a', { inputPath: '/a.wav', fileName: 'a.wav' })
    const { flows, opened } = setup([wav])
    flows.askConvertAll([wav], 'source', {
      mode: 'peak',
      targetLufs: -14,
      truePeakDb: -1,
      peakDb: -1,
    })
    expect(opened).toHaveLength(0)
  })

  // A trim counts as an active filter exactly like normalize: it also forces
  // planConversion off the stream-copy path (see reapply.ts's declick/normalize
  // comment on what "alters samples" means for copyOk).
  it('confirms a single convert that would re-encode an mp3 in place under source with a trim staged', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3', trim: { startSec: 1 } })
    const { flows, opened } = setup([mp3])
    const run = vi.fn()
    flows.askConvertOne(run, { track: mp3, format: 'source' })
    expect(opened[0].destructive).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  // A concrete mp3 pick under overwrite is the same in-place lossy re-encode as
  // 'source' resolving to mp3 — the warning must fire either way the format got there.
  // The lossy-specific wording wins over the generic overwrite dialog here: only it
  // names the actual risk (a lossy generation lost), which the plain "replaced and
  // cannot be recovered" copy never mentions.
  it('confirms a single convert that would re-encode an mp3 in place under overwrite with declick on, with the lossy wording', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3' })
    const { flows, opened } = setup([mp3], { settings: { overwriteOriginal: true } as Settings })
    const run = vi.fn()
    flows.askConvertOne(run, { track: mp3, format: 'mp3', declick: 'standard' })
    expect(opened[0].destructive).toBe(true)
    expect(opened[0].title).toBe('Re-encode the original MP3?')
    expect(run).not.toHaveBeenCalled()
  })

  // No filter, no warning: a plain in-place mp3 convert is a byte copy, and the single
  // path must stay one-click just as it does for any other non-destructive convert.
  it('does not confirm a single convert of an in-place mp3 under source with no filters active', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3' })
    const { flows, opened } = setup([mp3])
    const run = vi.fn()
    flows.askConvertOne(run, { track: mp3, format: 'source' })
    expect(opened).toHaveLength(0)
    expect(run).toHaveBeenCalledTimes(1)
  })

  // With nothing selected the editor reports no picks, so App passes normalize/declick
  // as undefined — exactly like processTrack falling back to settings.normalize when
  // the job carries none. A filter configured only in Settings degrades the file the
  // same as one chosen in the editor, so it must trip the same warning.
  it('confirms a batch convert-all with no picks when Settings normalize is on', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3' })
    const { flows, opened } = setup([mp3], {
      settings: {
        overwriteOriginal: false,
        normalize: { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      } as Settings,
    })
    flows.askConvertAll([mp3], 'source', undefined, undefined, undefined)
    expect(opened).toHaveLength(1)
    expect(opened[0].destructive).toBe(true)
  })

  // Same fallback, for declick instead of normalize, and through the single-convert path.
  it('confirms a single convert with no picks when Settings declick is on', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3' })
    const { flows, opened } = setup([mp3], {
      settings: { overwriteOriginal: false, declick: 'standard' } as Settings,
    })
    const run = vi.fn()
    flows.askConvertOne(run, { track: mp3, format: 'source' })
    expect(opened).toHaveLength(1)
    expect(opened[0].destructive).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  // The deliberate exemption must survive the settings fallback: a track reading its
  // own prior in-place export skips the filter (it is already baked in and won't run
  // again), even when Settings still has normalize turned on globally.
  it('does not confirm when the track reads its own export, even with Settings normalize on', () => {
    const mp3 = track('a', {
      inputPath: '/a.mp3',
      fileName: 'a.mp3',
      outputPath: '/a.mp3',
      status: 'done',
      processedNormalize: { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
    })
    const { flows, opened } = setup([mp3], {
      settings: {
        overwriteOriginal: false,
        normalize: { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      } as Settings,
    })
    flows.askConvertAll([mp3], 'source', undefined, undefined, undefined)
    expect(opened).toHaveLength(0)
  })

  // With keep on and a filter running, the UI's "convert to AIFF" is actually an
  // mp3-to-mp3 re-encode over the original: the generational-loss dialog must fire
  // even though the batch format says aiff.
  it('confirms a keep-mp3 batch whose filter forces a lossy re-encode', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3' })
    const { flows, opened } = setup([mp3], {
      settings: {
        outputFormat: 'aiff',
        keepMp3Sources: true,
        overwriteOriginal: false,
        normalize: { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      } as Settings,
    })
    flows.askConvertAll([mp3])
    expect(opened).toHaveLength(1)
    expect(opened[0].destructive).toBe(true)
  })

  // Without the setting, the same batch writes a fresh AIFF and never touches the
  // original: nothing to confirm. The contrast pins the warning to the rule, not the filter.
  it('does not confirm the same batch with keep mp3 off', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3' })
    const { flows, opened } = setup([mp3], {
      settings: {
        outputFormat: 'aiff',
        keepMp3Sources: false,
        overwriteOriginal: false,
        normalize: { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      } as Settings,
    })
    flows.askConvertAll([mp3])
    expect(opened).toHaveLength(0)
  })

  // The dial the user set on THIS track counts as an active filter exactly like the
  // batch pick and the Settings default already do above. hasActiveFilters asks
  // `normalize ?? settings?.normalize` and never looks at track.normalize, so a track
  // carrying its own normalization reads as filter-free: planConversion will still lose
  // copyOk and re-encode the mp3 in place, but the warning that exists to catch exactly
  // that never fires. The user loses a lossy generation on the only copy, unasked.
  it('confirms an in-place mp3 whose normalization was dialled on the track itself', () => {
    const mp3 = track('a', {
      inputPath: '/a.mp3',
      fileName: 'a.mp3',
      normalize: { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
    })
    const { flows, opened } = setup([mp3])

    flows.askConvertAll([mp3], 'source')

    expect(opened[0]?.destructive).toBe(true)
  })

  // Same for the click repair: it alters samples the same way, so the track's own
  // declick has to reach the check too.
  it('confirms an in-place mp3 whose declick was dialled on the track itself', () => {
    const mp3 = track('a', { inputPath: '/a.mp3', fileName: 'a.mp3', declick: 'strong' })
    const { flows, opened } = setup([mp3])

    flows.askConvertAll([mp3], 'source')

    expect(opened[0]?.destructive).toBe(true)
  })
})

describe('useConfirmFlows fill-all selection scope', () => {
  // Bulk actions follow the shared scope rule: a deliberate multi-selection wins over
  // the visible rows. The dialog must then say "selected", not "visible" — the count
  // alone can't tell a selection from a filter, so the caller states it.
  it('says selected when the fill targets a multi-selection', () => {
    const all = [track('a'), track('b'), track('c')]
    const { flows, opened } = setup(all)
    flows.askFillAll(all.slice(0, 2), { fromSelection: true })
    expect(opened[0].message.toLowerCase()).toContain('selected')
    expect(opened[0].message).toContain('2')
    expect(opened[0].message.toLowerCase()).not.toContain('visible')
  })
})
