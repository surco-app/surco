import { describe, expect, it } from 'vitest'
import ca from './locales/ca.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

type Step = { lead: string; text: string }
type Section = {
  id: string
  group?: string
  title: string
  s: string
  body: string[]
  steps?: Step[]
  points: string[]
}
type Related = { anchor: string }

const LOCALES = [
  ['es', es],
  ['en', en],
  ['de', de],
  ['fr', fr],
  ['pt-BR', ptBR],
  ['ja', ja],
  ['ca', ca],
] as const

const sections = (locale: unknown) => (locale as { guide: { sections: Section[] } }).guide.sections

const words = (section: Section) =>
  [
    section.s,
    ...section.body,
    ...(section.steps ?? []).flatMap((st) => [st.lead, st.text]),
    ...section.points,
  ]
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length

describe('the guide teaches how, in a few steps', () => {
  it.each(LOCALES)('%s walks every section in two to four steps', (_, locale) => {
    for (const section of sections(locale)) {
      const steps = section.steps ?? []
      expect(steps.length, section.id).toBeGreaterThanOrEqual(2)
      expect(steps.length, section.id).toBeLessThanOrEqual(4)
      for (const step of steps) {
        expect(step.lead.trim(), section.id).not.toBe('')
        expect(step.text.trim(), section.id).not.toBe('')
      }
    }
  })

  it.each(LOCALES)('%s folds at most four notes under each section', (_, locale) => {
    for (const section of sections(locale)) {
      expect(section.points.length, section.id).toBeLessThanOrEqual(4)
    }
  })

  it.each([
    ['es', es],
    ['en', en],
  ] as const)('%s keeps every section readable in about a minute', (_, locale) => {
    for (const section of sections(locale)) {
      expect(words(section), section.id).toBeLessThanOrEqual(200)
    }
  })
})

describe('links into the guide', () => {
  it.each(LOCALES)('%s points every use case at a guide section that exists', (_, locale) => {
    const ids = new Set(sections(locale).map((s) => s.id))
    const anchors = (
      locale as { useCases: { cases: { related?: Related[] }[] } }
    ).useCases.cases.flatMap((c) => (c.related ?? []).map((r) => r.anchor))
    expect(anchors.filter((a) => !ids.has(a))).toEqual([])
  })
})

type Group = { id: string; title: string }

const groups = (locale: unknown) => (locale as { guide: { groups?: Group[] } }).guide.groups ?? []

describe('the guide is read in blocks, in the order Surco is used', () => {
  it.each(LOCALES)('%s puts every section in a block, one block after another', (_, locale) => {
    const order = groups(locale).map((g) => g.id)
    const seen = sections(locale).map((s) => s.group ?? '')
    const runs = seen.filter((g, i) => g !== seen[i - 1])
    expect(runs).toEqual(order)
    expect(groups(locale).every((g) => g.title.trim() !== '')).toBe(true)
  })

  it.each(LOCALES)('%s groups the sections the same way as en', (_, locale) => {
    expect(sections(locale).map((s) => s.group)).toEqual(sections(en).map((s) => s.group))
    expect(groups(locale).map((g) => g.id)).toEqual(groups(en).map((g) => g.id))
  })
})
