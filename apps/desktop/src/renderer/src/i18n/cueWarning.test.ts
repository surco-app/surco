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
// was never updated. WAV is the only container that loses them now.
//
// Asserted against the locale files rather than a render: what breaks here is the copy
// drifting from what the convert path does, not the markup around it. Kept on this side
// of the renderer/main project boundary on purpose — importing tags.ts for the real
// preservesCuesInPlace would pull base91 and traktor4 into the web tsconfig.
describe('cue warning copy', () => {
  const locales = { de, en, es, fr, 'pt-BR': ptBR }

  const LOSES = /\b(lost|dropped|lose|loses|perde|perdem|pierden|perdus|verloren)\b/i

  // The clause FLAC appears in, isolated: every locale ends with a "WAV loses them"
  // clause, and matching the whole sentence flags a string that is in fact correct.
  const clauseFor = (text: string, format: string) =>
    text.split(/[.;]/).find((clause) => new RegExp(format, 'i').test(clause))

  it('never tells the user FLAC loses cues', () => {
    for (const [name, l] of Object.entries(locales)) {
      const clause = clauseFor(l.normalize.cueWarning, 'FLAC')
      expect(clause, `${name} normalize.cueWarning mentions FLAC`).toBeTruthy()
      expect(clause, `${name} normalize.cueWarning`).not.toMatch(LOSES)
    }
  })

  // WAV genuinely has nowhere to put them, and that half of the warning is the part
  // still worth showing — a fix that quietly dropped it would mislead the other way.
  it('still warns that WAV loses them', () => {
    for (const [name, l] of Object.entries(locales)) {
      const clause = clauseFor(l.normalize.cueWarning, 'WAV')
      expect(clause, `${name} normalize.cueWarning mentions WAV`).toBeTruthy()
      expect(clause, `${name} normalize.cueWarning`).toMatch(LOSES)
    }
  })

  // The short label sits under the checkbox with no room for the full sentence, so it
  // has to name the same set — "MP3/AIFF" alone reads as "not FLAC" at a glance.
  it('does not shorten the preserved set to MP3/AIFF', () => {
    for (const [name, l] of Object.entries(locales)) {
      expect(l.normalize.cueWarningShort, `${name} normalize.cueWarningShort`).not.toMatch(
        /MP3\/AIFF(?!\/FLAC)/i,
      )
    }
  })
})
