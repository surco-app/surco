import { describe, expect, it } from 'vitest'
import { selectWhatsNew } from './whatsNew'

const releases = [
  {
    version: '0.33',
    date: '10 de julio de 2026',
    title: 'Novedades y avisos',
    items: [
      { text: 'Popup de novedades tras actualizar.', in: '0.33.0' },
      { text: 'Arreglo del análisis a 48 kHz.', in: '0.33.1' },
    ],
  },
  {
    version: '0.32',
    date: '2 de julio de 2026',
    title: 'Deshacer, sesiones que vuelven y ALAC',
    items: [
      { text: 'Deshacer con ⌘Z.', in: '0.32.0' },
      { text: 'Exportación M3U8 corregida.', in: '0.32.2' },
    ],
  },
  {
    version: '0.31',
    date: '2 de julio de 2026',
    title: 'Emparejado más fino',
    // Pre-stamping history: plain strings carry no version, so the popup can never
    // know they are "new" for anyone — they must stay web-only.
    items: ['El auto-emparejado acierta más.'],
  },
]

function settings(over: Partial<Parameters<typeof selectWhatsNew>[1]> = {}) {
  return { hasSeenOnboarding: true, lastSeenChangelogVersion: '0.32.2', ...over }
}

describe('selectWhatsNew', () => {
  // The user asked for exactly this: patch granularity. Someone on 0.33.0 who
  // updates to 0.33.1 must see only what the patch shipped, not the whole minor
  // they already read about.
  it('shows only the items shipped after the last seen version', () => {
    const result = selectWhatsNew(releases, settings({ lastSeenChangelogVersion: '0.33.0' }), '0.33.1')
    expect(result).toEqual([
      { version: '0.33', title: 'Novedades y avisos', items: ['Arreglo del análisis a 48 kHz.'] },
    ])
  })

  // Skipping releases must not lose news: 0.32.2 → 0.33.1 covers both 0.33 patches,
  // grouped under their minor so the titles give each batch its context.
  it('accumulates items across skipped versions, grouped by minor', () => {
    const result = selectWhatsNew(releases, settings({ lastSeenChangelogVersion: '0.32.0' }), '0.33.1')
    expect(result).toEqual([
      {
        version: '0.33',
        title: 'Novedades y avisos',
        items: ['Popup de novedades tras actualizar.', 'Arreglo del análisis a 48 kHz.'],
      },
      { version: '0.32', title: 'Deshacer, sesiones que vuelven y ALAC', items: ['Exportación M3U8 corregida.'] },
    ])
  })

  // A fresh install has no "before" to compare against — telling a brand-new user
  // "what's new" would be noise on top of the onboarding wizard.
  it('returns null on a fresh install', () => {
    expect(
      selectWhatsNew(releases, settings({ hasSeenOnboarding: false, lastSeenChangelogVersion: '' }), '0.33.1'),
    ).toBeNull()
  })

  // Updating from a version that predates this feature leaves no stored stamp, but
  // onboarding-seen proves the install is not fresh — show the current minor so the
  // first post-feature update still announces itself.
  it('falls back to the current minor when there is no stored stamp on an existing install', () => {
    const result = selectWhatsNew(releases, settings({ lastSeenChangelogVersion: '' }), '0.33.1')
    expect(result).toEqual([
      {
        version: '0.33',
        title: 'Novedades y avisos',
        items: ['Popup de novedades tras actualizar.', 'Arreglo del análisis a 48 kHz.'],
      },
    ])
  })

  // Once seen, seen: the popup fires once per update, never on every launch.
  it('returns null when the current version was already seen', () => {
    expect(selectWhatsNew(releases, settings({ lastSeenChangelogVersion: '0.33.1' }), '0.33.1')).toBeNull()
  })

  // A pure-fix patch adds no stamped items; an empty popup would train the user to
  // dismiss it without reading.
  it('returns null when nothing user-facing shipped in between', () => {
    expect(selectWhatsNew(releases, settings({ lastSeenChangelogVersion: '0.32.2' }), '0.32.3')).toBeNull()
  })

  // Unstamped (pre-feature) items have no version to filter by, so they never
  // qualify — even on the no-stamp fallback path.
  it('never surfaces unstamped items', () => {
    const result = selectWhatsNew(releases, settings({ lastSeenChangelogVersion: '0.30.0' }), '0.33.1')
    expect(result?.some((r) => r.version === '0.31')).toBe(false)
  })

  // Downgrades and corrupt stamps fail closed: showing the popup on every launch is
  // exactly what the stored stamp exists to prevent.
  it('returns null on a downgrade or an unparseable stamp', () => {
    expect(selectWhatsNew(releases, settings({ lastSeenChangelogVersion: '0.34.0' }), '0.33.1')).toBeNull()
    expect(selectWhatsNew(releases, settings({ lastSeenChangelogVersion: 'garbage' }), '0.33.1')).toBeNull()
  })
})
