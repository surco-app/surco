import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import de from '../i18n/locales/de.json'
import es from '../i18n/locales/es.json'
import fr from '../i18n/locales/fr.json'
import ptBR from '../i18n/locales/pt-BR.json'
import {
  appliedMessage,
  ENGINE_QUEUE_WORDS,
  noticeText,
  partText,
  pillText,
} from './rekordboxQueueText'

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

  it('says the queue is on hold after a write left the collection unknown, whatever waits', () => {
    expect(pillText(tr, { tracks: 3, changes: 0, items: [], halted: true })).toBe(
      'rekordbox changes on hold',
    )
  })

  it.each([
    ['es', es.rekordboxQueue.halted],
    ['en', tr('rekordboxQueue.halted')],
    ['de', de.rekordboxQueue.halted],
    ['fr', fr.rekordboxQueue.halted],
    ['pt-BR', ptBR.rekordboxQueue.halted],
  ])(
    'warns in %s that Apply now on a held queue replaces the backup copy the user may need',
    (_lng, text) => {
      expect(text).toContain('master.db.surco-backup')
    },
  )

  it('says in Spanish that the queue is pending for another collection', () => {
    expect(es.rekordboxQueue.pillElsewhere).toBe('Pendiente de otra colección de rekordbox')
  })

  it('says the queue waits for another collection rather than for rekordbox to close', () => {
    expect(pillText(tr, { tracks: 1, changes: 0, items: [], elsewhere: true })).toBe(
      'Waiting for another rekordbox collection',
    )
  })

  it('says why nothing was written when the queue belongs to another collection', () => {
    expect(appliedMessage(tr, { refused: 'other-collection' })).toEqual({
      text: 'What is waiting belongs to another rekordbox collection, so nothing was changed. Go back to that collection or discard what is waiting',
      tone: 'danger',
    })
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

  it('names the cue notices so a marking rekordbox won over is never lost in silence', () => {
    expect(
      appliedMessage(tr, {
        tracks: 0,
        changes: 0,
        notices: [{ code: 'cues-changed', track: 'Tengo' }],
        written: [],
      })?.text,
    ).toBe('The cues of Tengo changed in rekordbox. Mark them again')
    expect(noticeText(tr, { code: 'cues-too-many', track: 'Tengo' })).toBe(
      'Tengo would need more than 8 hot cues. Remove a point',
    )
    expect(noticeText(tr, { code: 'cues-invalid', track: 'Tengo' })).toBe(
      'The cues of Tengo were not saved. Surco could not read them as cues',
    )
    expect(partText(tr, { kind: 'cues' })).toBe('cues')
  })

  it('says nothing when nothing landed and nothing was kept', () => {
    expect(appliedMessage(tr, { tracks: 0, changes: 0, notices: [], written: [] })).toBeNull()
  })
})

describe('Engine DJ queue text', () => {
  it('says the tracks wait for Engine DJ to close, not rekordbox', () => {
    expect(pillText(tr, { tracks: 2, changes: 0, items: [] }, ENGINE_QUEUE_WORDS)).toBe(
      '2 tracks wait for you to close Engine DJ',
    )
  })

  it('names the CALLs Engine DJ did not keep and where they were, in the same line as what landed', () => {
    expect(
      appliedMessage(
        tr,
        {
          tracks: 1,
          changes: 0,
          notices: [{ code: 'cues-calls-dropped', track: 'Tengo', calls: [4000, 72500] }],
          written: [],
        },
        ENGINE_QUEUE_WORDS,
      )?.text,
    ).toBe(
      'Done in Engine DJ · 1 track. 2 CALLs of Tengo were not saved (0:04, 1:12). Engine DJ only keeps hot cues',
    )
  })

  it('says the cues changed in Engine DJ when a save was refused for it', () => {
    expect(noticeText(tr, { code: 'cues-changed', track: 'Tengo' }, ENGINE_QUEUE_WORDS)).toBe(
      'The cues of Tengo changed in Engine DJ. Mark them again',
    )
  })

  it('says in Spanish which CALLs did not reach Engine DJ, plainly and without a colon', () => {
    expect(es.engineQueue.notice.callsDropped_one).toBe(
      'No se guardó el CALL de {{track}} ({{times}}). Engine DJ solo guarda hot cues',
    )
    expect(es.engineQueue.notice.callsDropped_other).toBe(
      'No se guardaron los {{count}} CALL de {{track}} ({{times}}). Engine DJ solo guarda hot cues',
    )
  })
})
