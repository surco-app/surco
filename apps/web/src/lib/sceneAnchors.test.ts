import { describe, expect, it } from 'vitest'
import ca from '../i18n/locales/ca.json'
import de from '../i18n/locales/de.json'
import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import fr from '../i18n/locales/fr.json'
import ja from '../i18n/locales/ja.json'
import ptBR from '../i18n/locales/pt-BR.json'
import { HERO_ANCHORS, SCENE_ANCHORS, SECTION_VIEWS } from './sceneAnchors'

const OTHER_HOME_IDS = ['top', 'main', 'mobile-nav']
const LOCALES = { es, en, de, fr, 'pt-BR': ptBR, ja, ca }

describe('scene anchors', () => {
  const ids = Object.values(SCENE_ANCHORS)

  it('gives every example its own id, since the browser scrolls a shared link to the first match', () => {
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never reuses an id the rest of the home already takes, or the link lands on the wrong block', () => {
    expect(ids.filter((id) => OTHER_HOME_IDS.includes(id))).toEqual([])
  })

  it('uses ids that survive being typed or pasted into a URL fragment unescaped', () => {
    expect(ids.filter((id) => !/^[a-z0-9-]+$/.test(id))).toEqual([])
  })
})

describe('hero anchors', () => {
  const sections: string[] = Object.values(SCENE_ANCHORS)

  it('links each promise under the hero to the section that proves it, so the click lands somewhere', () => {
    expect(HERO_ANCHORS).toHaveLength(3)
    for (const anchor of HERO_ANCHORS) expect(sections).toContain(anchor.target)
  })

  it('leads with the fake-lossless catch, the one problem a visitor does not know they have', () => {
    expect(HERO_ANCHORS[0].target).toBe(SCENE_ANCHORS.quality)
  })

  it.each(Object.entries(LOCALES))('gives every anchor a title and a line in %s', (_, locale) => {
    const anchors = locale.home.anchors as Record<string, { lead?: string; rest?: string }>
    for (const { key } of HERO_ANCHORS) {
      expect(anchors[key]?.lead, key).toBeTruthy()
      expect(anchors[key]?.rest, key).toBeTruthy()
    }
  })
})

describe('section views', () => {
  it('measures every section of the home, so a new one cannot ship without telling us who reaches it', () => {
    expect(Object.keys(SECTION_VIEWS).sort()).toEqual(Object.keys(SCENE_ANCHORS).sort())
  })

  it('reports each section under its own name, or two sections would add up as one', () => {
    const names = Object.values(SECTION_VIEWS)
    expect(new Set(names).size).toBe(names.length)
  })
})
