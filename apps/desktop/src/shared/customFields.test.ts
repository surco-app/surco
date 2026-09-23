import { describe, expect, it } from 'vitest'
import {
  customKeyProblem,
  customTagName,
  customValues,
  effectiveMeta,
  fieldValue,
  isCustomTag,
  suggestCustomKey,
} from './customFields'
import type { TrackMetadata } from './types'

const vinyl = { key: 'vinylCondition', label: 'Estado del vinilo' }

// The key is what the user types in a filename pattern, so it is proposed in the shape
// Surco's own keys have ({catalogNumber}), from whatever the user named the field.
describe('suggestCustomKey', () => {
  it('turns a name into a camelCase key without accents or symbols', () => {
    expect(suggestCustomKey('Estado del vinilo')).toBe('estadoDelVinilo')
    expect(suggestCustomKey('Compra: tienda & año')).toBe('compraTiendaAno')
  })

  it('never starts a key with a digit', () => {
    expect(suggestCustomKey('2nd pressing')).toBe('field2ndPressing')
  })
})

// A key the file tag of another field already uses would never read back: the reader
// takes that tag for the managed field, and the writer would fight over it.
describe('customKeyProblem', () => {
  it('accepts a free key', () => {
    expect(customKeyProblem('vinylCondition', [])).toBeNull()
  })

  it('rejects a key that cannot be a tag name everywhere', () => {
    expect(customKeyProblem('', [])).toBe('invalid')
    expect(customKeyProblem('2nd', [])).toBe('invalid')
    expect(customKeyProblem('vinyl condition', [])).toBe('invalid')
  })

  it('rejects the key of a field Surco already has, in any casing', () => {
    expect(customKeyProblem('Style', [])).toBe('taken')
    expect(customKeyProblem('catalogNumber', [])).toBe('taken')
  })

  it('rejects a key whose tag another field reads, like the label or a credit', () => {
    expect(customKeyProblem('label', [])).toBe('taken')
    expect(customKeyProblem('origArtist', [])).toBe('taken')
  })

  it('rejects a key another custom field already has', () => {
    expect(customKeyProblem('VinylCondition', [vinyl])).toBe('taken')
  })
})

describe('isCustomTag', () => {
  it('matches the tag of a custom field whatever its casing', () => {
    expect(isCustomTag('VINYLCONDITION', [vinyl])).toBe(true)
    expect(isCustomTag('vinylcondition', [vinyl])).toBe(true)
    expect(isCustomTag('PURCHASEDFROM', [vinyl])).toBe(false)
  })
})

// A field's value is the user's edit when there is one, else what the file carries, else
// empty. Reading it from the file's own tags at use means a field added after the tracks
// were loaded still shows their values.
describe('customValues', () => {
  const meta = {} as TrackMetadata

  it('takes the value the file carries under the field tag', () => {
    expect(customValues(meta, [{ name: 'VinylCondition', value: 'NM' }], [vinyl])).toEqual({
      vinylCondition: 'NM',
    })
  })

  it('prefers the user edit, even an emptied one', () => {
    const edited: TrackMetadata = { ...meta, custom: { vinylCondition: '' } }
    expect(customValues(edited, [{ name: 'VINYLCONDITION', value: 'NM' }], [vinyl])).toEqual({
      vinylCondition: '',
    })
  })

  it('is empty for a field the file does not carry', () => {
    expect(customValues(meta, [], [vinyl])).toEqual({ vinylCondition: '' })
  })
})

describe('customTagName', () => {
  it('writes the key upper-cased', () => {
    expect(customTagName('vinylCondition')).toBe('VINYLCONDITION')
  })
})

// Filename patterns and the required check name a field by key, so a custom field has to
// answer through the same lookup as a managed one.
describe('fieldValue', () => {
  const meta = { title: 'Song', custom: { vinylCondition: 'VG+' } } as unknown as TrackMetadata

  it('reads a managed field and a custom field by key', () => {
    expect(fieldValue(meta, 'title')).toBe('Song')
    expect(fieldValue(meta, 'vinylCondition')).toBe('VG+')
    expect(fieldValue(meta, 'nothing')).toBe('')
  })
})

// A track's custom values are not stored until the user edits them, so anything reading
// fields off a track resolves them first, from the file where the user has not.
describe('effectiveMeta', () => {
  it('fills the custom fields from the file tags the track still keeps', () => {
    const track = {
      meta: { title: 'Song' } as TrackMetadata,
      foreignTags: [
        { name: 'VINYLCONDITION', value: 'NM' },
        { name: 'SHOP', value: 'X' },
      ],
      foreignRemoved: ['SHOP'],
    }
    expect(effectiveMeta(track, [vinyl]).custom).toEqual({ vinylCondition: 'NM' })
  })

  it('leaves the metadata as it is when there are no custom fields', () => {
    const meta = { title: 'Song' } as TrackMetadata
    expect(effectiveMeta({ meta }, [])).toBe(meta)
  })
})
