import { describe, expect, it } from 'vitest'
import { composeMeta } from './composeAccents'

describe('composeMeta', () => {
  it('composes custom fields too, since they are written to the file like any other tag', () => {
    const meta = composeMeta({
      title: 'Olé'.normalize('NFD'),
      custom: { NOTE: 'rêve'.normalize('NFD') },
    })
    expect(meta.title).toBe('Olé'.normalize('NFC'))
    expect(meta.custom.NOTE).toBe('rêve'.normalize('NFC'))
  })

  it('leaves non-text values as they are', () => {
    const tags = { title: 'x', compilation: undefined, rating: 3 }
    expect(composeMeta(tags)).toEqual(tags)
  })
})
