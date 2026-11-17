import { describe, expect, it } from 'vitest'
import { splitByPatch } from './changelogPatches'

describe('splitByPatch', () => {
  it('keeps what shipped with the minor itself under the title, since the title describes it', () => {
    const { base, patches } = splitByPatch([
      { text: 'a', in: '1.38.0' },
      { text: 'b', in: '1.38.0' },
    ])
    expect(base.map((i) => (typeof i === 'string' ? i : i.text))).toEqual(['a', 'b'])
    expect(patches).toEqual([])
  })

  it('keeps the oldest history, which never recorded its patch, as one plain list', () => {
    const { base, patches } = splitByPatch(['a', 'b'])
    expect(base).toEqual(['a', 'b'])
    expect(patches).toEqual([])
  })

  it('puts each later patch in its own group so a reader can tell what an update brought', () => {
    const { base, patches } = splitByPatch([
      { text: 'a', in: '1.38.0' },
      { text: 'b', in: '1.38.1' },
      { text: 'c', in: '1.38.2' },
      { text: 'd', in: '1.38.1' },
    ])
    expect(base).toEqual([{ text: 'a', in: '1.38.0' }])
    expect(patches).toEqual([
      {
        version: '1.38.1',
        items: [
          { text: 'b', in: '1.38.1' },
          { text: 'd', in: '1.38.1' },
        ],
      },
      { version: '1.38.2', items: [{ text: 'c', in: '1.38.2' }] },
    ])
  })

  it('orders patches by release number, not by where the file lists them or as text', () => {
    const { patches } = splitByPatch([
      { text: 'a', in: '1.34.10' },
      { text: 'b', in: '1.34.3' },
      { text: 'c', in: '1.34.1' },
    ])
    expect(patches.map((p) => p.version)).toEqual(['1.34.1', '1.34.3', '1.34.10'])
  })
})
