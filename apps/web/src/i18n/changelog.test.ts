import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'

type Release = { version: string; date: string; title: string; items: string[] }

// The changelog page renders straight from this data, so an empty list or a
// shuffled order ships a broken or misleading page. Newest-first is the
// contract readers expect from a changelog.
describe.each([
  ['es', es.changelog.releases as Release[]],
  ['en', en.changelog.releases as Release[]],
])('%s changelog releases', (_lng, releases) => {
  it('has at least one release and every release lists features', () => {
    expect(releases.length).toBeGreaterThan(0)
    for (const r of releases) {
      expect(r.version).toMatch(/^\d+\.\d+$/)
      expect(r.date).not.toBe('')
      expect(r.title).not.toBe('')
      expect(r.items.length).toBeGreaterThan(0)
    }
  })

  it('orders releases newest first', () => {
    const numeric = releases.map((r) => r.version.split('.').map(Number))
    const sorted = [...numeric].sort((a, b) => b[0] - a[0] || b[1] - a[1])
    expect(numeric).toEqual(sorted)
  })
})
