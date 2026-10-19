import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { appliedMessage, noticeText, partText, pillText } from './rekordboxQueueText'

const tr = i18n.getFixedT('en')

describe('rekordbox queue text', () => {
  it('counts tracks first, tree changes otherwise, and hides with nothing waiting', () => {
    expect(pillText(tr, { tracks: 3, changes: 1, items: [] })).toBe(
      '3 tracks wait for you to close rekordbox',
    )
    expect(pillText(tr, { tracks: 0, changes: 2, items: [] })).toBe(
      '2 changes wait for you to close rekordbox',
    )
    expect(pillText(tr, { tracks: 0, changes: 0, items: [] })).toBeNull()
  })

  it('names what happens to each track', () => {
    expect(partText(tr, { kind: 'playlists', names: ['Makina', 'Cierre'] })).toBe(
      'to Makina, Cierre',
    )
    expect(partText(tr, { kind: 'collection' })).toBe('added to the collection')
    expect(partText(tr, { kind: 'tree', edit: 'rename' })).toBe('rename')
  })

  it('never lands in silence, naming what rekordbox kept in the same line as what landed', () => {
    expect(
      appliedMessage(tr, {
        tracks: 3,
        changes: 0,
        notices: [{ code: 'playlist-changed', track: 'Bam Bam', playlist: 'Makina' }],
        written: [],
      }),
    ).toEqual({
      text: 'Done in rekordbox · 3 tracks. Bam Bam was not changed in Makina. It changed in rekordbox',
      tone: 'neutral',
    })
  })

  it('says why a track or an edit was skipped, for every notice code that can arrive', () => {
    expect(noticeText(tr, { code: 'ambiguous', track: 'Bam Bam' })).toBe(
      'Bam Bam was not added. rekordbox has it twice',
    )
    expect(noticeText(tr, { code: 'file-missing', track: 'Bam Bam' })).toBe(
      'Bam Bam was not added to the collection. The file is gone',
    )
    expect(noticeText(tr, { code: 'not-added', track: 'Bam Bam' })).toBe(
      'Bam Bam was not added to the collection. The file could not be read',
    )
    expect(noticeText(tr, { code: 'playlist-gone', track: 'Bam Bam', playlist: 'Makina' })).toBe(
      'Makina is no longer in rekordbox. Bam Bam was not added',
    )
    expect(noticeText(tr, { code: 'edit-changed', playlist: 'Makina' })).toBe(
      'Makina was not changed. It changed in rekordbox',
    )
  })

  it('says the copy failed and that it will try again', () => {
    expect(appliedMessage(tr, { refused: 'backup-failed' })).toEqual({
      text: 'Could not back up rekordbox. Surco will try again when you close it',
      tone: 'danger',
    })
  })

  it('reports a write that failed on close as an error instead of staying quiet', () => {
    expect(appliedMessage(tr, { refused: 'write-failed' })).toEqual({
      text: tr('sources.edit.refused.writeFailed'),
      tone: 'danger',
    })
  })

  it('says nothing when nothing landed and nothing was kept', () => {
    expect(appliedMessage(tr, { tracks: 0, changes: 0, notices: [], written: [] })).toBeNull()
  })
})
