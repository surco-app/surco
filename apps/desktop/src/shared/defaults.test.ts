import { describe, expect, it } from 'vitest'
import { DEFAULT_IMPORT_FIELDS, IMPORTABLE_FIELDS, normalizeImportFields } from './defaults'

// The stored preference is a plain string[] in settings.json, so what comes back is whatever
// was on disk — written by an older build, a newer one, or a hand edit. It reaches
// buildReleaseMeta as a set of metadata keys, and casting it there would let a stale or
// unknown name through as if it were a real field.
describe('normalizeImportFields', () => {
  // The whole point of the preference: a field the user switched off stays off.
  it('keeps the fields the user chose', () => {
    expect(normalizeImportFields(['album', 'country'])).toEqual(['album', 'country'])
  })

  // A name that isn't an importable field can only be junk — a removed field from an older
  // version, or a typo in a hand-edited file. Dropping it keeps the list meaning exactly
  // "these metadata keys" rather than "these strings we hope are keys".
  it('drops names that are not importable fields', () => {
    expect(normalizeImportFields(['album', 'nonsense', 'bpm'])).toEqual(['album'])
  })

  // No preference stored (every install before this feature) must mean "import everything",
  // so upgrading never silently stops tagging.
  it('falls back to every importable field when the preference is missing', () => {
    expect(normalizeImportFields(undefined)).toEqual(DEFAULT_IMPORT_FIELDS)
  })

  // An empty list is a real choice — "let Discogs fill nothing" — and must survive rather
  // than being mistaken for "unset" and reset to importing everything.
  it('keeps an empty selection empty rather than treating it as unset', () => {
    expect(normalizeImportFields([])).toEqual([])
  })

  // A settings.json that somehow holds a non-array (hand edit, corrupted write) must not
  // crash the editor or produce a bogus field list.
  it('falls back to the default when the stored value is not a list', () => {
    expect(normalizeImportFields('album' as unknown as string[])).toEqual(DEFAULT_IMPORT_FIELDS)
  })

  // Guards the catalog itself: every name it offers has to survive its own filter, or the
  // preference would offer a switch that normalization then silently discards.
  it('accepts every field the catalog offers', () => {
    expect(normalizeImportFields([...IMPORTABLE_FIELDS])).toEqual(IMPORTABLE_FIELDS)
  })
})
