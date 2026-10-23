import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'

// The page this one replaced announced free signing by SignPath for a certificate that was
// never issued. The Microsoft Store links here as Surco's privacy policy, so it has to say
// only what is true: no signing claims, and the data that does leave the computer.
describe('privacy page', () => {
  it('makes no code signing claim in either language', () => {
    expect(JSON.stringify(en.privacy)).not.toMatch(/SignPath|signing|signed/i)
    expect(JSON.stringify(es.privacy)).not.toMatch(/SignPath|firma/i)
  })

  it('names every service the app talks to', () => {
    for (const locale of [en, es]) {
      const names = locale.privacy.policies.map((p: { name: string }) => p.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'Discogs',
          'Bandcamp',
          'Deezer',
          'Beatport',
          'MusicBrainz',
          'GitHub',
        ]),
      )
    }
  })
})
