import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import {
  type CheckDetail,
  VERIFY_DETAIL_KEYS,
  type VerifyDetailKey,
} from '../../../shared/verification'
import { detailText } from '../components/VerifiedPopover'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const LOCALES: [string, Record<string, unknown>][] = [
  ['es', es],
  ['en', en],
  ['de', de],
  ['fr', fr],
  ['pt-BR', ptBR],
  ['ja', ja],
]

// Every params shape main sends with each key, both branches where detailText picks a
// sibling string (lossy or not, original kept or not) and both plural forms where it counts.
// The Record makes a key added to VERIFY_DETAIL_KEYS fail to compile until it is listed here.
const SENT: Record<VerifyDetailKey, CheckDetail['params'][]> = {
  pending: [{ program: 'rekordbox' }],
  checking: [undefined],
  fileIdentical: [{ format: 'WAV' }],
  fileReencoded: [
    { format: 'FLAC', rate: 44100, bits: 24 },
    { format: 'MP3', rate: 44100, bits: 0 },
  ],
  fileMissing: [undefined],
  fileWrongFormat: [{ expected: 'FLAC', actual: 'WAV' }],
  fileTruncated: [undefined],
  filePcmDiffers: [undefined],
  fileTagDiffers: [
    { field: 'title' },
    { field: 'artist' },
    { field: 'album' },
    { field: 'albumArtist' },
    { field: 'genre' },
    { field: 'year' },
    { field: 'trackNumber' },
    { field: 'bpm' },
    { field: 'key' },
    { field: 'grouping' },
    { field: 'comment' },
  ],
  fileNoCover: [undefined],
  fileCoverKept: [undefined],
  fileUnreadable: [undefined],
  fileSourceGone: [{ kept: 0 }, { kept: 1 }],
  musicOne: [{ playlists: ['24', 'All'] }],
  musicOneNoPlaylists: [undefined],
  musicMissing: [undefined],
  musicNoFile: [undefined],
  musicOtherFile: [undefined],
  musicWrongFile: [{ format: 'AIFF' }],
  musicDuplicate: [{ count: 2 }],
  musicTagDiffers: [{ field: 'title' }, { field: 'artist' }, { field: 'album' }],
  musicNoArtwork: [undefined],
  musicPlaylistLost: [{ playlist: 'Warm up' }],
  musicUnreadable: [undefined],
  rekordboxOk: [
    { format: 'WAV', cues: 1 },
    { format: 'WAV', cues: 13 },
  ],
  rekordboxStillOld: [{ format: 'AIFF' }],
  rekordboxMissing: [undefined],
  rekordboxAmbiguous: [{ count: 2 }],
  rekordboxOtherRow: [undefined],
  rekordboxSizeDiffers: [undefined],
  rekordboxCuesLost: [
    { before: 1, after: 0 },
    { before: 8, after: 3 },
  ],
  rekordboxCuesChanged: [
    { before: 1, after: 4 },
    { before: 3, after: 8 },
  ],
  rekordboxAnalysisEmptied: [undefined],
  rekordboxUnreadable: [undefined],
  engineOk: [{ format: 'WAV' }],
  engineStillOld: [{ format: 'AIFF' }],
  engineMissing: [undefined],
  engineAmbiguous: [{ count: 2 }],
  engineOtherRow: [undefined],
  engineNoFileType: [undefined],
  engineSizeDiffers: [undefined],
  engineSizeStale: [undefined],
  engineSizeStaleCues: [{ field: 'quickCues' }, { field: 'beatData' }, { field: 'loops' }],
  enginePerformanceChanged: [{ field: 'quickCues' }, { field: 'beatData' }, { field: 'loops' }],
  engineCuesMisplaced: [{ field: 'quickCues' }, { field: 'beatData' }, { field: 'loops' }],
  engineUnreadable: [undefined],
  traktorOk: [{ format: 'WAV' }],
  traktorStillOld: [{ format: 'AIFF' }],
  traktorMissing: [undefined],
  traktorAmbiguous: [{ count: 2 }],
  traktorCuesChanged: [undefined],
  traktorUnreadable: [undefined],
}

// The shield and the amber line print whatever key main judged with. A key with no string in
// the active language falls back to English at best and to the raw "verify.detail.x" at
// worst, so each one is rendered here against each catalogue alone, with no fallback.
describe('verification details', () => {
  it('lists every key main can send', () => {
    expect(Object.keys(SENT).sort()).toEqual([...VERIFY_DETAIL_KEYS].sort())
  })

  it.each(LOCALES)(
    '%s reads every detail main can send, without a raw key or brace',
    (lng, locale) => {
      const i18n = i18next.createInstance()
      void i18n.init({
        lng,
        resources: { [lng]: { translation: locale } },
        fallbackLng: false,
        interpolation: { escapeValue: false },
      })
      const unread = VERIFY_DETAIL_KEYS.flatMap((key) =>
        SENT[key].map((params) => ({
          key,
          text: detailText({ key, params }, (k, o) => i18n.t(k, o), lng),
        })),
      ).filter(({ text }) => text === '' || /\{\{|[A-Za-z]\.[A-Za-z]/.test(text))
      expect(unread).toEqual([])
    },
  )

  // A stale row left the cues, the grid or the loops behind: the line names which.
  it.each(LOCALES)('%s names what of a stale Engine DJ row did not follow', (lng, locale) => {
    const i18n = i18next.createInstance()
    void i18n.init({
      lng,
      resources: { [lng]: { translation: locale } },
      fallbackLng: false,
      interpolation: { escapeValue: false },
    })
    const texts = ['quickCues', 'beatData', 'loops'].map((field) =>
      detailText({ key: 'engineSizeStaleCues', params: { field } }, (k, o) => i18n.t(k, o), lng),
    )
    expect(new Set(texts).size).toBe(3)
  })
})
