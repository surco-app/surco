import { describe, expect, it } from 'vitest'
import ca from './locales/ca.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import itIT from './locales/it.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const BATCH_WORD = {
  de: [de, 'merk'],
  en: [en, 'apply'],
  es: [es, 'aplicar'],
  fr: [fr, 'appliquer'],
  ja: [ja, '適用待ち'],
  'pt-BR': [ptBR, 'aplicar'],
  ca: [ca, 'aplicar'],
  it: [itIT, 'applicare'],
} as const

// English said "Stage 2 proposals" and "Unstage" beside "in the batch", and a DJ read
// "Stage 1" as a step of the review. Putting a proposal in, taking it out and the mark it
// leaves are one batch, so they name it with the same word.
describe('the review batch', () => {
  it.each(Object.entries(BATCH_WORD))('is one word in %s', (_, [locale, word]) => {
    const review = locale.musicReview
    for (const label of [
      review.inTray,
      review.staged,
      review.incomplete.stageAll_one,
      review.incomplete.stageAll_other,
    ]) {
      expect(label.toLowerCase()).toContain(word)
    }
  })
})
