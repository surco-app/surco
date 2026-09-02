import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ptBR from './locales/pt-BR.json'

// djotas reported the normalize warning as factually wrong: it told him a FLAC encode
// loses Traktor's cues, so he stopped trusting the conversion and re-derived the whole
// PRIV/base91 story himself to check. It had been wrong since copyCuesToFlac landed —
// before that an ID3 source really did lose every cue on the way to FLAC, and the string
// was never updated.
//
// The same drift then happened to WAV: this file used to pin "WAV loses them", and kept
// pinning it after the cue matrix landed (cueMatrix.test.ts walks all four sources into
// all four targets and finds no empty cell). A test that fixes a fact in place outlives
// the fact — so what it asserts now is the shape the copy has to keep: name ALAC as the
// one that drops them, and never name a container that keeps them as losing them.
//
// Asserted against the locale files rather than a render: what breaks here is the copy
// drifting from what the convert path does, not the markup around it. Kept on this side
// of the renderer/main project boundary on purpose — importing tags.ts for the real
// keepsCuesInId3 would pull base91 and traktor4 into the web tsconfig.
describe('cue warning copy', () => {
  const locales = { de, en, es, fr, 'pt-BR': ptBR }

  const LOSES = /\b(lost|dropped|lose|loses|perde|perdem|pierden|perdus|verloren)\b/i

  // The clause FLAC appears in, isolated: every locale ends with a "WAV loses them"
  // clause, and matching the whole sentence flags a string that is in fact correct.
  const clauseFor = (text: string, format: string) =>
    text.split(/[.;]/).find((clause) => new RegExp(format, 'i').test(clause))

  // The four containers the cue matrix proves keep them, in every cross.
  const KEEPS = ['MP3', 'AIFF', 'FLAC', 'WAV']

  it('never tells the user a container that keeps cues loses them', () => {
    for (const [name, l] of Object.entries(locales)) {
      for (const warning of ['cueWarning', 'cueWarningShort'] as const) {
        for (const section of ['normalize', 'trim'] as const) {
          for (const format of KEEPS) {
            const clause = clauseFor(l[section][warning], format)
            if (clause) {
              expect(clause, `${name} ${section}.${warning} on ${format}`).not.toMatch(LOSES)
            }
          }
        }
      }
      // The trim card grew its own copy of the same claim (trim.planCues), and the drift
      // this file exists to catch reappeared there verbatim: it shipped "WAV loses them"
      // while the convert path preserved them. Any key that repeats the fact gets pinned.
      for (const format of KEEPS) {
        const clause = clauseFor(l.trim.planCues, format)
        if (clause) {
          expect(clause, `${name} trim.planCues on ${format}`).not.toMatch(LOSES)
        }
      }
    }
  })

  // ALAC genuinely has nowhere to put them — no ID3 to write into — and that half of the
  // warning is the part still worth showing: a fix that dropped it would mislead the
  // other way, which is how this test was wrong about WAV.
  it('warns that ALAC loses them', () => {
    for (const [name, l] of Object.entries(locales)) {
      const clause = clauseFor(l.normalize.cueWarning, 'ALAC')
      expect(clause, `${name} normalize.cueWarning mentions ALAC`).toBeTruthy()
      expect(clause, `${name} normalize.cueWarning`).toMatch(LOSES)
    }
  })

  // The short label sits under the checkbox with no room for the full sentence, so it
  // must not name a subset — any partial list reads as "not the ones I left out".
  it('does not shorten the preserved set to a subset', () => {
    for (const [name, l] of Object.entries(locales)) {
      for (const section of ['normalize', 'trim'] as const) {
        expect(l[section].cueWarningShort, `${name} ${section}.cueWarningShort`).not.toMatch(
          /MP3\/AIFF(\/FLAC)?(?!\/WAV)/i,
        )
      }
    }
  })
})
