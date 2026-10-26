import { describe, expect, it } from 'vitest'
import en from './changelog/en.json'
import es from './changelog/es.json'
import enLocale from './locales/en.json'
import esLocale from './locales/es.json'

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

  it('opens with the same release in both languages, since the home hero announces it', () => {
    expect(releases[0].version).toBe((es as Release[])[0].version)
    expect(releases[0].version).toBe((en as Release[])[0].version)
  })

  it('orders releases newest first', () => {
    const numeric = releases.map((r) => r.version.split('.').map(Number))
    const sorted = [...numeric].sort((a, b) => b[0] - a[0] || b[1] - a[1])
    expect(numeric).toEqual(sorted)
  })
})

// The "in testing" block sits outside the changelog files on purpose: those also feed the
// desktop "what's new" popup, which filters by version, and a -beta.N stamp there would hide
// the items from everyone who later updates to the stable release that carries them.
describe('the beta block', () => {
  type Beta = { version: string; items: string[] }
  const betaOf = (locale: { changelog: { beta: Beta } }) => locale.changelog.beta

  it('names the same beta in both languages, with the same number of items', () => {
    const [b, e] = [betaOf(esLocale), betaOf(enLocale)]
    expect(b.version).toBe(e.version)
    expect(b.items).toHaveLength(e.items.length)
  })

  it('names a beta version while it lists anything, and nothing once the stable ships', () => {
    const beta = betaOf(esLocale)
    if (beta.items.length > 0) expect(beta.version).toMatch(/^\d+\.\d+\.\d+-beta\.\d+$/)
    for (const item of [...beta.items, ...betaOf(enLocale).items]) expect(item.trim()).not.toBe('')
  })
})
