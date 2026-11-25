import type { TFunction } from 'i18next'
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
  partText,
  pillText,
  type QueueWords,
  REKORDBOX_QUEUE_WORDS,
  SERATO_QUEUE_WORDS,
  TRAKTOR_QUEUE_WORDS,
  VIRTUALDJ_QUEUE_WORDS,
} from './rekordboxQueueText'

const tr = i18n.getFixedT('en')

const LOCALES = { en, es, de, fr, 'pt-BR': ptBR, ja, ca, it: itIT }

function fixedT(lng: string, bundle: object) {
  if (!i18n.hasResourceBundle(lng, 'translation'))
    i18n.addResourceBundle(lng, 'translation', bundle)
  return i18n.getFixedT(lng)
}

function rows(
  notices: RekordboxQueueNotice[],
  words: QueueWords = REKORDBOX_QUEUE_WORDS,
  t: TFunction = tr,
) {
  return appliedMessage(t, { tracks: 0, changes: 0, notices, written: [] }, words)?.rows
}

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
    expect(rows([unfit])?.[0].goTo).toEqual({ contentId: '7', ms: 1000 })
    expect(appliedMessage(tr, { tracks: 2, changes: 0, notices: [], written: [] })?.rows).toEqual(
      [],
    )
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

  it('names a waiting comment in the queue pill in every language, so the DJ sees only the comment is coming', () => {
    expect(partText(tr, { kind: 'comment' })).toBe('comment')
    expect([es, en, ca, de, fr, itIT, ja, ptBR].map((l) => l.rekordboxQueue.part.comment)).toEqual([
      'comentario',
      'comment',
      'comentari',
      'Kommentar',
      'commentaire',
      'commento',
      'コメント',
      'comentário',
    ])
  })

  it('names a node move in the queue pill', () => {
    expect(partText(tr, { kind: 'tree', edit: 'moveNode' })).toBe('move')
  })

  // A batch used to come back as one paragraph, a sentence per track: six tracks and four
  // playlist refusals filled the window. The line says what landed, and each reason gets
  // one row with the tracks it hit, so the DJ reads why first and who second.
  it('says what landed in one line and gathers the tracks rekordbox kept under one row per reason', () => {
    expect(
      appliedMessage(tr, {
        tracks: 6,
        changes: 0,
        notices: [
          { code: 'playlist-changed', track: 'Madagascar', playlist: 'Warm Up' },
          { code: 'playlist-changed', track: 'Soca Boys', playlist: 'Warm Up' },
          { code: 'cues-unfit', track: 'Rave Allstars', count: 16, contentId: '7', ms: 1000 },
          { code: 'playlist-changed', track: 'Oxia', playlist: 'Warm Up' },
          { code: 'playlist-changed', track: 'Bam Bam', playlist: 'Cierre' },
        ],
        written: [],
      }),
    ).toEqual({
      text: 'Done in rekordbox · 6 tracks',
      tone: 'neutral',
      rows: [
        {
          icon: 'list',
          tone: 'warn',
          title: '3 tracks not changed in Warm Up',
          sub: 'It changed in rekordbox · Madagascar, Soca Boys, Oxia',
        },
        {
          icon: 'cue',
          tone: 'warn',
          title: '16 cues off rekordbox’s beats',
          sub: 'Left where they were. Check them · Rave Allstars',
          goTo: { contentId: '7', ms: 1000 },
        },
        {
          icon: 'list',
          tone: 'warn',
          title: '1 track not changed in Cierre',
          sub: 'It changed in rekordbox · Bam Bam',
        },
      ],
    })
  })

  it('names each track once in its row even when the same reason came back for it twice', () => {
    expect(
      rows([
        { code: 'cues-changed', track: 'Tengo' },
        { code: 'cues-changed', track: 'Tengo' },
      ])?.[0].sub,
    ).toBe('Changed in rekordbox. Mark them again · Tengo')
  })

  it('says why a track or an edit was skipped, for every notice code that can arrive', () => {
    const say = (notice: RekordboxQueueNotice) => {
      const r = rows([notice])?.[0]
      return `${r?.title} | ${r?.sub}`
    }
    expect(say({ code: 'cues-adjusted', track: 'Pray', moved: 4, maxMs: 7 })).toBe(
      '4 cues moved onto rekordbox’s grid | The furthest 7 ms · Pray',
    )
    expect(say({ code: 'ambiguous', track: 'Bam Bam' })).toBe(
      '1 track not added to rekordbox | Twice in rekordbox · Bam Bam',
    )
    expect(say({ code: 'file-missing', track: 'Bam Bam' })).toBe(
      '1 track not added to rekordbox | The file is gone · Bam Bam',
    )
    expect(say({ code: 'not-added', track: 'Bam Bam' })).toBe(
      '1 track not added to rekordbox | The file could not be read · Bam Bam',
    )
    expect(say({ code: 'playlist-gone', track: 'Bam Bam', playlist: 'Makina' })).toBe(
      '1 track not added to Makina | It is no longer in rekordbox · Bam Bam',
    )
    expect(say({ code: 'edit-changed', playlist: 'Makina' })).toBe(
      'Makina not changed | It changed in rekordbox',
    )
    expect(say({ code: 'not-in-library', track: 'Tengo' })).toBe(
      '1 track no longer in rekordbox | Playlists not changed · Tengo',
    )
  })

  it('marks the cues rekordbox only nudged onto its grid as news, not as a problem', () => {
    expect(rows([{ code: 'cues-adjusted', track: 'Pray', moved: 1, maxMs: 3 }])?.[0]).toMatchObject(
      { icon: 'cue', tone: 'neutral' },
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
      }),
    ).toEqual({
      text: '',
      tone: 'neutral',
      rows: [
        {
          icon: 'cue',
          tone: 'warn',
          title: 'Cues of 1 track not saved',
          sub: 'Changed in rekordbox. Mark them again · Tengo',
        },
      ],
    })
    expect(rows([{ code: 'cues-too-many', track: 'Tengo' }])?.[0].sub).toBe(
      'More than 8 hot cues. Remove a mark · Tengo',
    )
    expect(rows([{ code: 'cues-invalid', track: 'Tengo' }])?.[0].sub).toBe(
      'Surco could not read them as cues · Tengo',
    )
    expect(rows([{ code: 'cues-write-failed', track: 'Tengo' }])?.[0].sub).toBe(
      'Surco could not write the file · Tengo',
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

  it('counts every CALL Engine DJ did not keep across the tracks, under the line of what landed', () => {
    expect(
      appliedMessage(
        tr,
        {
          tracks: 2,
          changes: 0,
          notices: [
            { code: 'cues-calls-dropped', track: 'Tengo', calls: [4000, 72500] },
            { code: 'cues-calls-dropped', track: 'Pray', calls: [9000] },
          ],
          written: [],
        },
        ENGINE_QUEUE_WORDS,
      ),
    ).toMatchObject({
      text: 'Done in Engine DJ · 2 tracks',
      rows: [{ title: '3 CALLs not saved', sub: 'Engine DJ only keeps hot cues · Tengo, Pray' }],
    })
  })

  it('says the cues changed in Engine DJ when a save was refused for it', () => {
    expect(rows([{ code: 'cues-changed', track: 'Tengo' }], ENGINE_QUEUE_WORDS)?.[0].sub).toBe(
      'Changed in Engine DJ. Mark them again · Tengo',
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
    expect(
      rows([{ code: 'cues-slot-dropped', track: 'Tengo' }], TRAKTOR_QUEUE_WORDS)?.[0],
    ).toMatchObject({
      title: 'Cue H of 1 track not saved',
      sub: "Traktor has 7 buttons for Surco's cues · Tengo",
    })
  })

  it('says a playlist changed in Traktor when an edit was refused for it', () => {
    expect(
      rows([{ code: 'edit-changed', playlist: 'Friday' }], TRAKTOR_QUEUE_WORDS)?.[0],
    ).toMatchObject({ title: 'Friday not changed', sub: 'It changed in Traktor' })
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
    expect(rows([{ code: 'cues-changed', track: 'Tengo' }], TRAKTOR_QUEUE_WORDS)?.[0].sub).toBe(
      'Changed in Traktor. Mark them again · Tengo',
    )
  })
})

describe('playlist notices from the Traktor and Engine DJ queues', () => {
  it('name the app that holds the playlists, never rekordbox', () => {
    const subs = (words: QueueWords) =>
      rows(
        [
          { code: 'playlist-changed', track: 'Tengo', playlist: 'Friday' },
          { code: 'playlist-gone', track: 'Tengo', playlist: 'House' },
          { code: 'not-in-library', track: 'Tengo' },
        ],
        words,
      )?.map((r) => r.sub)
    expect(subs(TRAKTOR_QUEUE_WORDS)).toEqual([
      'It changed in Traktor · Tengo',
      'It is no longer in Traktor · Tengo',
      'Playlists not changed · Tengo',
    ])
    expect(subs(ENGINE_QUEUE_WORDS)?.[1]).toBe('It is no longer in Engine DJ · Tengo')
    expect(rows([{ code: 'not-in-library', track: 'Tengo' }], ENGINE_QUEUE_WORDS)?.[0].title).toBe(
      '1 track no longer in Engine DJ',
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
      ),
    ).toMatchObject({
      text: 'Done in Serato · 1 track',
      rows: [{ title: '1 CALL not saved', sub: 'Serato only keeps hot cues · Tengo' }],
    })
  })

  it('says a converted track stayed out of a crate that lives on another drive', () => {
    expect(
      rows([{ code: 'other-volume', track: 'Tengo', playlist: 'Gig' }], SERATO_QUEUE_WORDS)?.[0],
    ).toMatchObject({ title: '1 track not added to Gig', sub: 'On another drive · Tengo' })
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
    for (const [lng, bundle] of Object.entries(LOCALES)) {
      const t = fixedT(lng, bundle)
      for (const notice of notices) {
        const r = rows([notice], SERATO_QUEUE_WORDS, t)?.[0]
        const text = `${r?.title} ${r?.sub}`
        if (notice.code !== 'other-volume')
          expect(text, `${lng} ${notice.code}`).toContain('Serato')
        expect(text, `${lng} ${notice.code}`).not.toMatch(/rekordbox/i)
      }
    }
  })

  it('says a review tag change left a track Serato no longer has, without talking about crates', () => {
    expect(
      rows([{ code: 'tags-not-in-library', track: 'Tengo' }], SERATO_QUEUE_WORDS)?.[0],
    ).toMatchObject({ title: '1 track no longer in Serato', sub: 'Tags not changed · Tengo' })
    expect(
      rows(
        [{ code: 'tags-not-in-library', track: 'Tengo' }],
        SERATO_QUEUE_WORDS,
        fixedT('es', es),
      )?.[0],
    ).toMatchObject({ title: '1 pista ya no está en Serato', sub: 'Etiquetas sin cambiar · Tengo' })
  })

  it('says a review tag change left a track the user changed in Serato meanwhile', () => {
    expect(rows([{ code: 'tags-changed', track: 'Tengo' }], SERATO_QUEUE_WORDS)?.[0]).toMatchObject(
      {
        title: 'Tags of 1 track not changed',
        sub: 'Changed in Serato · Tengo',
      },
    )
  })

  it('says only that a track was not added to Serato, since Serato gives no reason', () => {
    expect(rows([{ code: 'not-added', track: 'Tengo' }], SERATO_QUEUE_WORDS)?.[0]).toMatchObject({
      title: '1 track not added to Serato',
      sub: 'Tengo',
    })
  })

  it('says a converted track whose original Serato keeps stays out of the crate the user chose', () => {
    expect(
      rows(
        [{ code: 'source-in-serato', track: 'Tengo', playlist: 'Gig' }],
        SERATO_QUEUE_WORDS,
        fixedT('es', es),
      )?.[0],
    ).toMatchObject({
      title: '1 pista no se añadió a Gig',
      sub: 'Serato se queda el archivo original · Tengo',
    })
  })

  it('says why Surco left a track whose older Serato cues say something else, and how to clear it', () => {
    expect(rows([{ code: 'cues-old-block', track: 'Tengo' }], SERATO_QUEUE_WORDS)?.[0].sub).toBe(
      'Serato keeps an older copy. Move a cue there and save again · Tengo',
    )
  })

  it('says a queued crate edit that Serato changed under it in Serato words, not rekordbox', () => {
    expect(rows([{ code: 'edit-changed', playlist: 'Friday' }], SERATO_QUEUE_WORDS)?.[0].sub).toBe(
      'It changed in Serato',
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
    const trackLines = (
      rows(
        (['cues-write-failed', 'cues-invalid', 'cues-too-many', 'cues-changed'] as const).map(
          (code) => ({ code, track: 'Tengo' }),
        ),
        SERATO_QUEUE_WORDS,
      ) ?? []
    ).map((r) => `${r.title} ${r.sub}`)
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
      rows(
        [{ code: 'cues-calls-dropped', track: 'Pray', calls: [90000] }],
        VIRTUALDJ_QUEUE_WORDS,
      )?.[0],
    ).toMatchObject({ title: '1 CALL not saved', sub: 'VirtualDJ only keeps hot cues · Pray' })
    expect(rows([{ code: 'cues-changed', track: 'Pray' }], VIRTUALDJ_QUEUE_WORDS)?.[0].sub).toBe(
      'Changed in VirtualDJ. Mark them again · Pray',
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
    const say = (notice: RekordboxQueueNotice) => {
      const r = rows([notice], VIRTUALDJ_QUEUE_WORDS)?.[0]
      return `${r?.title} | ${r?.sub}`
    }
    expect(say({ code: 'not-added', track: 'Pray' })).toBe('1 track not added to VirtualDJ | Pray')
    expect(say({ code: 'playlist-changed', track: 'Pray', playlist: 'Sets' })).toBe(
      '1 track not changed in Sets | It changed in VirtualDJ · Pray',
    )
    expect(say({ code: 'playlist-gone', track: 'Pray', playlist: 'Sets' })).toBe(
      '1 track not added to Sets | It is no longer in VirtualDJ · Pray',
    )
    expect(say({ code: 'source-in-virtualdj', track: 'Pray', playlist: 'Sets' })).toBe(
      '1 track not added to Sets | VirtualDJ keeps the original file · Pray',
    )
    expect(say({ code: 'tags-not-in-library', track: 'Pray' })).toBe(
      '1 track no longer in VirtualDJ | Tags not changed · Pray',
    )
    expect(say({ code: 'tags-changed', track: 'Pray' })).toBe(
      'Tags of 1 track not changed | Changed in VirtualDJ · Pray',
    )
    expect(say({ code: 'repoint-other-volume', track: 'Pray.aiff' })).toBe(
      '1 track kept on the original file | On another drive · Pray.aiff',
    )
    expect(say({ code: 'repoint-song-taken', track: 'Pray.aiff' })).toBe(
      '1 track kept on the original file | VirtualDJ already has a song for it · Pray.aiff',
    )
    expect(say({ code: 'repoint-unwritable', track: 'Pray.aiff' })).toBe(
      '1 track kept on the original file | VirtualDJ cannot take its length · Pray.aiff',
    )
    expect(say({ code: 'repoint-song-taken-gone', track: 'Pray.aiff' })).toBe(
      '1 old song points to a missing file | VirtualDJ already had a song for it · Pray.aiff',
    )
    expect(partText(tr, { kind: 'collection' }, VIRTUALDJ_QUEUE_WORDS)).toBe('added to the library')
    expect(partText(tr, { kind: 'playlists', names: [] }, VIRTUALDJ_QUEUE_WORDS)).toBe(
      'out of its lists',
    )
  })

  it('says a track is gone from VirtualDJ when its song is not in the database', () => {
    expect(
      rows([{ code: 'not-in-library', track: 'Pray' }], VIRTUALDJ_QUEUE_WORDS)?.[0],
    ).toMatchObject({ title: '1 track no longer in VirtualDJ', sub: 'Cues not saved · Pray' })
  })

  it('words the VirtualDJ backups warning in every language', () => {
    for (const locale of [en, es, de, fr, ja, ptBR, ca, itIT]) {
      expect(locale.virtualdjQueue.writeUnknown).toContain('virtualdj-backups')
      expect(locale.virtualdjQueue.writeUnknown).toContain('database.xml')
      expect(locale.virtualdjQueue.writeUnknown).not.toMatch(/—|: /)
    }
  })
})
