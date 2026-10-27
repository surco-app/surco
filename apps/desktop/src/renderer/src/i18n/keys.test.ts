import { describe, expect, it } from 'vitest'
import { ERROR_KEYS } from '../../../shared/errorKeys'
import type { UsbFailure } from '../../../shared/types'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ptBR from './locales/pt-BR.json'

// Every visible string is keyed; a missing key silently falls back to the other
// language and ships an untranslated UI. Flattening both trees and comparing the
// key sets catches that before it reaches a build.
function keys(obj: unknown, prefix = ''): string[] {
  if (Array.isArray(obj)) {
    return obj.flatMap((item, i) => keys(item, `${prefix}[${i}]`))
  }
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
  }
  return [prefix]
}

function leaves(obj: unknown, prefix = ''): [string, string][] {
  if (Array.isArray(obj)) {
    return obj.flatMap((item, i) => leaves(item, `${prefix}[${i}]`))
  }
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
  }
  return typeof obj === 'string' ? [[prefix, obj]] : []
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
}

const LOCALES: [string, unknown][] = [
  ['es', es],
  ['de', de],
  ['fr', fr],
  ['pt-BR', ptBR],
]

describe('locale parity', () => {
  it.each(LOCALES)('%s exposes the exact same keys as en', (_, locale) => {
    expect(keys(locale).sort()).toEqual(keys(en).sort())
  })

  // mainErrorMessage translates a stamped key as `errors.<key>`, so an ErrorKey with no
  // catalogue entry shows the user the raw marker text. The union is the contract and
  // nothing else checks it: engineDjOpen's sentence sat hardcoded in Spanish precisely
  // because no test tied the two sides together.
  it.each(LOCALES)('%s has a string for every stamped error key', (_, locale) => {
    const catalogue = new Map(leaves(locale))
    for (const key of ERROR_KEYS) expect(catalogue.has(`errors.${key}`)).toBe(true)
  })

  // A translation that drops or renames a {{placeholder}} renders the raw braces (or
  // nothing) at runtime; comparing per-key placeholder sets against English catches it.
  // A singular form may leave {{count}} out ("el CALL"): i18next always passes the count,
  // so leaving it unsaid renders no braces, and only languages that read 0 as singular
  // need the number spelled.
  it.each(LOCALES)('%s keeps every interpolation placeholder en uses', (_, locale) => {
    const reference = new Map(leaves(en))
    const compared = (key: string, text: string) =>
      placeholders(text).filter((ph) => !(key.endsWith('_one') && ph === 'count'))
    for (const [key, text] of leaves(locale)) {
      const enText = reference.get(key)
      if (enText === undefined) continue
      expect({ key, ph: compared(key, text) }).toEqual({ key, ph: compared(key, enText) })
    }
  })
})

// Every view of the USB export renders `usbExport.errors.<reason>`; a code main can send
// with no string there shows the user the raw key. The Record makes a new UsbFailure fail
// to compile until it is listed here.
const USB_FAILURES: Record<UsbFailure, true> = {
  unsupported: true,
  'no-collection': true,
  unreadable: true,
  'nothing-selected': true,
  'volume-gone': true,
  'volume-changed': true,
  'not-removable': true,
  'not-volume-root': true,
  'no-baken': true,
  refused: true,
  'baken-failed': true,
  'device-write': true,
  'no-space': true,
  busy: true,
  'rekordbox-open': true,
  'sources-unreachable': true,
  'playlist-empty': true,
  'source-lost': true,
  'sync-files': true,
  'stick-ids-full': true,
  'engine-missing': true,
  'engine-unreadable': true,
  'engine-open': true,
  'engine-foreign': true,
  'engine-schema': true,
}

describe('USB export failures', () => {
  it.each([['en', en], ...LOCALES])('%s says every reason an export can fail', (_, locale) => {
    const catalogue = new Map(leaves(locale))
    const missing = Object.keys(USB_FAILURES).filter(
      (reason) => !catalogue.has(`usbExport.errors.${reason}`),
    )
    expect(missing).toEqual([])
  })
})

describe('search sources hint', () => {
  it('names every source the checkboxes offer, Beatport included, in every language', () => {
    for (const locale of [es, en, de, fr, ptBR]) {
      expect(locale.settings.searchProvidersHint).toContain('Beatport')
    }
  })
})

describe('skipped library activity lines', () => {
  it('read as one sentence with a comma, without an explanatory colon, in every language', () => {
    for (const locale of [es, en, de, fr, ptBR]) {
      const { rekordboxCollectionMissing, engineCollectionMissing, traktorSyncCollectionMissing } =
        locale.activity
      for (const text of [
        rekordboxCollectionMissing,
        engineCollectionMissing,
        traktorSyncCollectionMissing,
      ])
        expect(text).not.toContain(':')
    }
  })
})

// The owner's writing rule for every visible string: no em dash. A sentence split by one
// reads as an aside bolted on; each language says the same with a period, a comma or
// parentheses.
describe('em dashes', () => {
  it.each([['en', en], ...LOCALES])('%s has none in any string', (_, locale) => {
    expect(leaves(locale).filter(([, text]) => text.includes('\u2014'))).toEqual([])
  })
})

describe('cue editor copy', () => {
  it('never says donde rompe, since a flow is placed on any point and not every DJ marks the drop, except Auto marcar, whose detector looks for where the track breaks', () => {
    const autoMark = ['editor.cues.auto.ask', 'editor.cues.auto.none', 'editor.cues.auto.marked']
    expect(
      leaves(es)
        .filter(([key, text]) => /rompe/i.test(text) && !autoMark.includes(key))
        .map(([key]) => key),
    ).toEqual([])
  })

  it('names Auto marcar in the help as the button reads, so a DJ who reads it finds the button', () => {
    for (const locale of [es, en, de, fr, ptBR])
      expect(locale.editor.cues.help).toContain(locale.editor.cues.auto.button)
  })
})
