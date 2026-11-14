import { describe, expect, it } from 'vitest'
import type { RekordboxQueueNotice } from '../../../shared/types'
import i18n from '../i18n'
import ca from '../i18n/locales/ca.json'
import de from '../i18n/locales/de.json'
import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import fr from '../i18n/locales/fr.json'
import itIT from '../i18n/locales/it.json'
import ja from '../i18n/locales/ja.json'
import ptBR from '../i18n/locales/pt-BR.json'
import {
  appliedMessage,
  ENGINE_QUEUE_WORDS,
  noticeText,
  partText,
  pillText,
  SERATO_QUEUE_WORDS,
  TRAKTOR_QUEUE_WORDS,
  VIRTUALDJ_QUEUE_WORDS,
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

  // rekordbox was closed and the pill still asked to close it: the wait was for the drive.
  it('says what waits for a collection on a disconnected drive waits for the drive', () => {
    expect(pillText(tr, { tracks: 1, changes: 0, items: [], unplugged: true })).toBe(
      '1 track waits for you to connect the rekordbox drive',
    )
    expect(pillText(tr, { tracks: 0, changes: 2, items: [], unplugged: true })).toBe(
      '2 changes wait for you to connect the rekordbox drive',
    )
    expect(
      pillText(tr, { tracks: 1, changes: 0, items: [], unplugged: true }, TRAKTOR_QUEUE_WORDS),
    ).toBe('1 track waits for you to connect the Traktor drive')
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
    ['ca', ca.rekordboxQueue.halted],
    ['it', itIT.rekordboxQueue.halted],
  ])(
    'warns in %s that Apply now on a held queue replaces the backup copy the user may need',
    (_lng, text) => {
      expect(text).toContain('master.db.surco-backup')
    },
  )

  it('says in Spanish that the queue is pending for another collection', () => {
    expect(es.rekordboxQueue.pillElsewhere_other).toBe(
      '{{count}} pendientes de otra colección de rekordbox',
    )
  })

  it('counts how much waits for another collection when nothing waits for this one, so the pill is not a bare warning', () => {
    expect(pillText(tr, { tracks: 0, changes: 0, items: [], elsewhere: 2 })).toBe(
      '2 waiting for another rekordbox collection',
    )
  })

  // Each collection keeps its own queue: what waits for this one is what closing rekordbox
  // now applies, so the pill counts it and leaves the other collection to the panel.
  it('counts what waits for this collection even while another collection waits too', () => {
    expect(pillText(tr, { tracks: 1, changes: 0, items: [], elsewhere: 2 })).toBe(
      '1 track waits for you to close rekordbox',
    )
  })

  it('points at the first cue left off the grid, so the notice can take the DJ to it', () => {
    const unfit = { code: 'cues-unfit' as const, track: 'Pray', count: 2, contentId: '7', ms: 1000 }
    expect(
      appliedMessage(tr, { tracks: 0, changes: 1, notices: [unfit], written: [] })?.goTo,
    ).toEqual({
      contentId: '7',
      ms: 1000,
    })
    expect(
      appliedMessage(tr, { tracks: 2, changes: 0, notices: [], written: [] })?.goTo,
    ).toBeUndefined()
  })

  it('names what happens to each track', () => {
    expect(partText(tr, { kind: 'playlists', names: ['Makina', 'Cierre'] })).toBe(
      'to Makina, Cierre',
    )
    expect(partText(tr, { kind: 'collection' })).toBe('added to the collection')
    expect(partText(tr, { kind: 'tree', edit: 'rename' })).toBe('rename')
  })

  it('names a waiting Matching pair in the queue pill', () => {
    expect(partText(tr, { kind: 'matching' })).toBe('Matching')
  })

  it('names a node move in the queue pill', () => {
    expect(partText(tr, { kind: 'tree', edit: 'moveNode' })).toBe('move')
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
    expect(noticeText(tr, { code: 'cues-adjusted', track: 'Pray', moved: 4, maxMs: 7 })).toBe(
      'rekordbox has analysed Pray. 4 cues moved onto its grid, the furthest 7 ms',
    )
    expect(noticeText(tr, { code: 'cues-adjusted', track: 'Pray', moved: 1, maxMs: 3 })).toBe(
      'rekordbox has analysed Pray. 1 cue moved onto its grid, 3 ms',
    )
    expect(
      noticeText(tr, { code: 'cues-unfit', track: 'Pray', count: 1, contentId: '7', ms: 1000 }),
    ).toBe('One cue of Pray sits far from rekordbox’s beats and was left where it was. Check it')
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
      'Tengo would need more than 8 hot cues. Remove a mark',
    )
    expect(noticeText(tr, { code: 'cues-invalid', track: 'Tengo' })).toBe(
      'The cues of Tengo were not saved. Surco could not read them as cues',
    )
    expect(noticeText(tr, { code: 'cues-write-failed', track: 'Tengo' })).toBe(
      'The cues of Tengo were not saved. Surco could not write the file',
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

describe('Traktor queue text', () => {
  it('says the tracks wait for Traktor to close', () => {
    expect(pillText(tr, { tracks: 2, changes: 0, items: [] }, TRAKTOR_QUEUE_WORDS)).toBe(
      '2 tracks wait for you to close Traktor',
    )
  })

  it('names the track whose cue H did not fit on Traktor’s buttons', () => {
    expect(noticeText(tr, { code: 'cues-slot-dropped', track: 'Tengo' }, TRAKTOR_QUEUE_WORDS)).toBe(
      "Traktor has 7 buttons for Surco's cues, so cue H of Tengo was not saved",
    )
  })

  it('says a playlist changed in Traktor when an edit was refused for it', () => {
    expect(noticeText(tr, { code: 'edit-changed', playlist: 'Friday' }, TRAKTOR_QUEUE_WORDS)).toBe(
      'Friday was not changed. It changed in Traktor',
    )
  })

  it('speaks of changes, not only cues, now that playlists wait in the same queue', () => {
    expect(tr(TRAKTOR_QUEUE_WORDS.discardConfirm)).toBe(
      'Discard what is waiting? Your Traktor playlists and cues stay as Traktor has them',
    )
    expect(tr(TRAKTOR_QUEUE_WORDS.refused('write-failed'))).toBe(
      "Couldn't save the changes to Traktor. The collection is as it was",
    )
  })

  it('says the cues changed in Traktor when a save was refused for it', () => {
    expect(noticeText(tr, { code: 'cues-changed', track: 'Tengo' }, TRAKTOR_QUEUE_WORDS)).toBe(
      'The cues of Tengo changed in Traktor. Mark them again',
    )
  })
})

describe('playlist notices from the Traktor and Engine DJ queues', () => {
  it('name the app that holds the playlists, never rekordbox', () => {
    expect(
      noticeText(
        tr,
        { code: 'playlist-changed', track: 'Tengo', playlist: 'Friday' },
        TRAKTOR_QUEUE_WORDS,
      ),
    ).toBe('Tengo was not changed in Friday. It changed in Traktor')
    expect(
      noticeText(
        tr,
        { code: 'playlist-gone', track: 'Tengo', playlist: 'House' },
        ENGINE_QUEUE_WORDS,
      ),
    ).toBe('House is no longer in Engine DJ. Tengo was not added')
    expect(noticeText(tr, { code: 'not-in-library', track: 'Tengo' }, ENGINE_QUEUE_WORDS)).toBe(
      'Tengo is no longer in Engine DJ. Its playlists were not changed',
    )
    expect(noticeText(tr, { code: 'not-in-library', track: 'Tengo' }, TRAKTOR_QUEUE_WORDS)).toBe(
      'Tengo is no longer in Traktor. Its playlists were not changed',
    )
  })
})

describe('Serato queue text', () => {
  it('sends the DJ to the Serato backups before opening Serato when a write could be neither saved nor undone, never saying the files are intact', () => {
    const backups =
      "Couldn't save the changes or undo them, so the library may have changed. Before opening Serato, restore the crates from the most recent copy in the serato-backups folder in Surco's data"
    expect(tr(SERATO_QUEUE_WORDS.halted)).toBe(backups)
    expect(appliedMessage(tr, { refused: 'write-unknown' }, SERATO_QUEUE_WORDS)?.text).toBe(backups)
    expect(appliedMessage(tr, { refused: 'write-failed' }, SERATO_QUEUE_WORDS)?.text).toBe(
      "Couldn't save the changes to Serato. The files are as they were",
    )
  })

  it('names what happens to each track in Serato words, library and crates', () => {
    expect(partText(tr, { kind: 'collection' }, SERATO_QUEUE_WORDS)).toBe('added to the library')
    expect(partText(tr, { kind: 'playlists', names: [] }, SERATO_QUEUE_WORDS)).toBe(
      'out of its crates',
    )
    expect(partText(tr, { kind: 'playlists', names: ['Gig'] }, SERATO_QUEUE_WORDS)).toBe('to Gig')
    expect(partText(tr, { kind: 'collection' }, TRAKTOR_QUEUE_WORDS)).toBe(
      'added to the collection',
    )
  })

  it('words the Serato backups warning in every language', () => {
    expect(es.seratoQueue.writeUnknown).toBe(
      'No se pudieron guardar los cambios ni deshacerlos, así que la biblioteca puede haber cambiado. Antes de abrir Serato, recupera los crates de la copia más reciente en la carpeta serato-backups de los datos de Surco',
    )
    for (const locale of [en, es, de, fr, ja, ptBR, ca, itIT]) {
      expect(locale.seratoQueue.writeUnknown).toContain('serato-backups')
      expect(locale.seratoQueue.writeUnknown).not.toMatch(/—|: /)
    }
  })

  it('says the tracks wait for Serato to close', () => {
    expect(pillText(tr, { tracks: 2, changes: 0, items: [] }, SERATO_QUEUE_WORDS)).toBe(
      '2 tracks wait for you to close Serato',
    )
  })

  it('says what landed in Serato and which CALLs it did not keep', () => {
    expect(
      appliedMessage(
        tr,
        {
          tracks: 1,
          changes: 0,
          notices: [{ code: 'cues-calls-dropped', track: 'Tengo', calls: [4000] }],
          written: [],
        },
        SERATO_QUEUE_WORDS,
      )?.text,
    ).toBe(
      'Done in Serato · 1 track. 1 CALL of Tengo was not saved (0:04). Serato only keeps hot cues',
    )
  })

  it('says a converted track stayed out of a crate that lives on another drive', () => {
    expect(
      noticeText(tr, { code: 'other-volume', track: 'Tengo', playlist: 'Gig' }, SERATO_QUEUE_WORDS),
    ).toBe('Tengo is on another drive and cannot go in the crate “Gig”')
  })

  it('names Serato, never rekordbox, in every notice about a converted track the Serato queue gives', () => {
    const notices: RekordboxQueueNotice[] = [
      { code: 'not-added', track: 'Tengo' },
      { code: 'playlist-changed', track: 'Tengo', playlist: 'Gig' },
      { code: 'playlist-gone', track: 'Tengo', playlist: 'Gig' },
      { code: 'other-volume', track: 'Tengo', playlist: 'Gig' },
      { code: 'source-in-serato', track: 'Tengo', playlist: 'Gig' },
      { code: 'tags-not-in-library', track: 'Tengo' },
      { code: 'tags-changed', track: 'Tengo' },
    ]
    for (const [lng, bundle] of Object.entries({
      en,
      es,
      de,
      fr,
      'pt-BR': ptBR,
      ja,
      ca,
      it: itIT,
    })) {
      if (!i18n.hasResourceBundle(lng, 'translation'))
        i18n.addResourceBundle(lng, 'translation', bundle)
      const t = i18n.getFixedT(lng)
      for (const notice of notices) {
        const text = noticeText(t, notice, SERATO_QUEUE_WORDS)
        if (notice.code !== 'other-volume')
          expect(text, `${lng} ${notice.code}`).toContain('Serato')
        expect(text, `${lng} ${notice.code}`).not.toMatch(/rekordbox/i)
      }
    }
  })

  it('says a review tag change left a track Serato no longer has, without talking about crates', () => {
    expect(
      noticeText(tr, { code: 'tags-not-in-library', track: 'Tengo' }, SERATO_QUEUE_WORDS),
    ).toBe('Tengo is no longer in Serato and its tags were not changed')
    if (!i18n.hasResourceBundle('es', 'translation'))
      i18n.addResourceBundle('es', 'translation', es)
    expect(
      noticeText(
        i18n.getFixedT('es'),
        { code: 'tags-not-in-library', track: 'Tengo' },
        SERATO_QUEUE_WORDS,
      ),
    ).toBe('Tengo ya no está en Serato y sus etiquetas no se cambiaron')
  })

  it('says a review tag change left a track the user changed in Serato meanwhile', () => {
    expect(noticeText(tr, { code: 'tags-changed', track: 'Tengo' }, SERATO_QUEUE_WORDS)).toBe(
      'Tengo changed in Serato and its tags were not changed',
    )
  })

  it('keeps the rekordbox wording for rekordbox while Serato gets its own', () => {
    expect(noticeText(tr, { code: 'not-in-library', track: 'Tengo' })).toContain('rekordbox')
  })

  it('says a converted track whose original Serato keeps stays out of the crate the user chose', () => {
    if (!i18n.hasResourceBundle('es', 'translation'))
      i18n.addResourceBundle('es', 'translation', es)
    expect(
      noticeText(
        i18n.getFixedT('es'),
        { code: 'source-in-serato', track: 'Tengo', playlist: 'Gig' },
        SERATO_QUEUE_WORDS,
      ),
    ).toBe('Tengo sigue en Serato con el archivo original y no entra en el crate «Gig»')
  })

  it('says why Surco left a track whose older Serato cues say something else, and how to clear it', () => {
    expect(noticeText(tr, { code: 'cues-old-block', track: 'Tengo' }, SERATO_QUEUE_WORDS)).toBe(
      'The cues of Tengo were not saved. Serato keeps an older copy of them that does not match. Move any cue of the track in Serato and save again',
    )
  })

  it('says the cues changed in Serato when a save was refused for it', () => {
    expect(noticeText(tr, { code: 'cues-changed', track: 'Tengo' }, SERATO_QUEUE_WORDS)).toBe(
      'The cues of Tengo changed in Serato. Mark them again',
    )
  })

  it('says a queued crate edit that Serato changed under it in Serato words, not rekordbox', () => {
    expect(noticeText(tr, { code: 'edit-changed', playlist: 'Friday' }, SERATO_QUEUE_WORDS)).toBe(
      'Friday was not changed. It changed in Serato',
    )
  })

  it('speaks of Serato alone in anything the Serato queue can say', () => {
    const queueLines = [
      tr(SERATO_QUEUE_WORDS.discardConfirm),
      tr(SERATO_QUEUE_WORDS.refused('write-failed')),
      tr(SERATO_QUEUE_WORDS.refused('unreadable')),
      tr(SERATO_QUEUE_WORDS.backupFailed),
      tr(SERATO_QUEUE_WORDS.halted),
      pillText(tr, { tracks: 1, changes: 0, items: [], halted: true }, SERATO_QUEUE_WORDS),
      pillText(tr, { tracks: 1, changes: 0, items: [], unplugged: true }, SERATO_QUEUE_WORDS),
      pillText(tr, { tracks: 0, changes: 0, items: [], elsewhere: 1 }, SERATO_QUEUE_WORDS),
      tr(SERATO_QUEUE_WORDS.elsewhere, { count: 1 }),
    ]
    for (const line of queueLines) expect(line).toMatch(/Serato/)
    const trackLines = (['cues-write-failed', 'cues-invalid', 'cues-too-many'] as const).map(
      (code) => noticeText(tr, { code, track: 'Tengo' }, SERATO_QUEUE_WORDS),
    )
    for (const line of [...queueLines, ...trackLines])
      expect(line).not.toMatch(/rekordbox|Engine DJ|Traktor/)
  })
})

describe('VirtualDJ queue text', () => {
  it('sends the DJ to the VirtualDJ backups before opening VirtualDJ when a write could be neither saved nor undone', () => {
    const backups =
      "Couldn't save the changes or undo them, so the library may have changed. Before opening VirtualDJ, restore database.xml from the most recent copy in the virtualdj-backups folder in Surco's data"
    expect(tr(VIRTUALDJ_QUEUE_WORDS.halted)).toBe(backups)
    expect(appliedMessage(tr, { refused: 'write-unknown' }, VIRTUALDJ_QUEUE_WORDS)?.text).toBe(
      backups,
    )
    expect(appliedMessage(tr, { refused: 'write-failed' }, VIRTUALDJ_QUEUE_WORDS)?.text).toBe(
      "Couldn't save the changes to VirtualDJ. The files are as they were",
    )
  })

  it('says in VirtualDJ’s words that a CALL was not saved and that cues changed there', () => {
    expect(
      noticeText(
        tr,
        { code: 'cues-calls-dropped', track: 'Pray', calls: [90000] },
        VIRTUALDJ_QUEUE_WORDS,
      ),
    ).toBe('1 CALL of Pray was not saved (1:30). VirtualDJ only keeps hot cues')
    expect(noticeText(tr, { code: 'cues-changed', track: 'Pray' }, VIRTUALDJ_QUEUE_WORDS)).toBe(
      'The cues of Pray changed in VirtualDJ. Mark them again',
    )
  })

  it('never tells the DJ to close VirtualDJ for saves that wait for another or a missing VirtualDJ library, since closing it would not write them', () => {
    const waiting = { tracks: 2, changes: 0, items: [] }
    expect(pillText(tr, { ...waiting, unplugged: true }, VIRTUALDJ_QUEUE_WORDS)).toBe(
      '2 tracks wait until Surco finds the VirtualDJ library',
    )
    expect(pillText(tr, { ...waiting, tracks: 0, elsewhere: 3 }, VIRTUALDJ_QUEUE_WORDS)).toBe(
      '3 waiting for another VirtualDJ library',
    )
    expect(tr(VIRTUALDJ_QUEUE_WORDS.elsewhere, { count: 3 })).toBe(
      '3 changes wait for another VirtualDJ library. They will be applied when you go back to it',
    )
  })

  it('says in VirtualDJ’s words what became of a converted track and its lists', () => {
    const say = (notice: Parameters<typeof noticeText>[1]) =>
      noticeText(tr, notice, VIRTUALDJ_QUEUE_WORDS)
    expect(say({ code: 'not-added', track: 'Pray' })).toBe('Pray was not added to VirtualDJ')
    expect(say({ code: 'playlist-changed', track: 'Pray', playlist: 'Sets' })).toBe(
      'Pray was not changed in Sets. It changed in VirtualDJ',
    )
    expect(say({ code: 'playlist-gone', track: 'Pray', playlist: 'Sets' })).toBe(
      'Sets is no longer in VirtualDJ. Pray was not added',
    )
    expect(say({ code: 'source-in-virtualdj', track: 'Pray', playlist: 'Sets' })).toBe(
      'Pray stays in VirtualDJ with the original file and does not go in the list “Sets”',
    )
    expect(say({ code: 'tags-not-in-library', track: 'Pray' })).toBe(
      'Pray is no longer in VirtualDJ and its tags were not changed',
    )
    expect(say({ code: 'tags-changed', track: 'Pray' })).toBe(
      'Pray changed in VirtualDJ and its tags were not changed',
    )
    expect(say({ code: 'repoint-other-volume', track: 'Pray.aiff' })).toBe(
      'Pray.aiff is on another disk, so VirtualDJ keeps the original file and Surco keeps it too',
    )
    expect(say({ code: 'repoint-song-taken', track: 'Pray.aiff' })).toBe(
      'VirtualDJ already has a song for Pray.aiff, so it keeps the original file and Surco keeps it too',
    )
    expect(partText(tr, { kind: 'collection' }, VIRTUALDJ_QUEUE_WORDS)).toBe('added to the library')
    expect(partText(tr, { kind: 'playlists', names: [] }, VIRTUALDJ_QUEUE_WORDS)).toBe(
      'out of its lists',
    )
  })

  it('says a track is gone from VirtualDJ when its song is not in the database', () => {
    expect(noticeText(tr, { code: 'not-in-library', track: 'Pray' }, VIRTUALDJ_QUEUE_WORDS)).toBe(
      'Pray is no longer in VirtualDJ. Its cues were not saved',
    )
  })

  it('words the VirtualDJ backups warning in every language', () => {
    for (const locale of [en, es, de, fr, ja, ptBR, ca, itIT]) {
      expect(locale.virtualdjQueue.writeUnknown).toContain('virtualdj-backups')
      expect(locale.virtualdjQueue.writeUnknown).toContain('database.xml')
      expect(locale.virtualdjQueue.writeUnknown).not.toMatch(/—|: /)
    }
  })
})
