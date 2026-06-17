import { describe, expect, it } from 'vitest'
import { METADATA_KEYS } from '../shared/metadata'
import { TAG_FIELDS } from './tagFields'

describe('TAG_FIELDS', () => {
  it('maps exactly the TrackMetadata fields, so a new field is never silently unreadable/unwritable', () => {
    // Tied to the metadata SSOT: adding a field to TrackMetadata without a tag mapping
    // would otherwise leave it read from no tag and written to no frame, with no error.
    expect(new Set(TAG_FIELDS.map((f) => f.key))).toEqual(new Set(METADATA_KEYS))
  })

  it('lists read aliases in lowercase, since the probe matches case-insensitively on lowercased keys', () => {
    for (const field of TAG_FIELDS) {
      for (const alias of field.aliases) {
        expect(alias, `${field.key} alias "${alias}"`).toBe(alias.toLowerCase())
      }
    }
  })
})
