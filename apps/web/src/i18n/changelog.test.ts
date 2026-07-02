import { describe, expect, it } from 'vitest'
import en from './changelog/en.json'
import es from './changelog/es.json'

type Item = string | { text: string; in: string }
type Release = { version: string; date: string; title: string; items: Item[] }

// The changelog page renders straight from this data, so an empty list or a
// shuffled order ships a broken or misleading page. Newest-first is the
// contract readers expect from a changelog. Stamped items ({text, in}) also
// feed the desktop "what's new" popup, which filters by the exact version an
// item shipped in — a stamp outside its own minor entry would surface the item
// under the wrong release or never at all.
describe.each([
  ['es', es as Release[]],
  ['en', en as Release[]],
])('%s changelog releases', (_lng, releases) => {
  it('has at least one release and every release lists features', () => {
    expect(releases.length).toBeGreaterThan(0)
    for (const r of releases) {
      expect(r.version).toMatch(/^\d+\.\d+$/)
      expect(r.date).not.toBe('')
      expect(r.title).not.toBe('')
      expect(r.items.length).toBeGreaterThan(0)
      for (const item of r.items) {
        if (typeof item === 'string') {
          expect(item).not.toBe('')
        } else {
          expect(item.text).not.toBe('')
          expect(item.in).toMatch(/^\d+\.\d+\.\d+$/)
          expect(item.in.startsWith(`${r.version}.`)).toBe(true)
        }
      }
    }
  })

  it('orders releases newest first', () => {
    const numeric = releases.map((r) => r.version.split('.').map(Number))
    const sorted = [...numeric].sort((a, b) => b[0] - a[0] || b[1] - a[1])
    expect(numeric).toEqual(sorted)
  })
})
