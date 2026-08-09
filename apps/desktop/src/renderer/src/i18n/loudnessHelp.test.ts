import { describe, expect, it } from 'vitest'
import en from './locales/en.json'

// A user wrote in: the loudness figures meant nothing to someone still learning what a
// good value looks like, and there was no way to tell which ones a Surco setting could
// still fix from the ones already baked into the master. Every metric now states its
// good band and what can be done about it.
//
// Asserted against the locale rather than a render: the modal is a flat map over
// METRICS, so what can actually break is a missing or drifted string — and mounting
// ModalShell here installs a focus trap that leaks into the next test file's globals.
describe('loudness help copy', () => {
  const METRICS = ['Lufs', 'Peak', 'Range', 'Crest', 'Balance', 'Dc', 'Noise']
  const editor = en.editor as Record<string, string>

  it('gives every metric a definition, a good range and a fix note', () => {
    for (const m of METRICS) {
      expect(editor[`loudness${m}Help`], `loudness${m}Help`).toBeTruthy()
      expect(editor[`loudnessRange${m}`], `loudnessRange${m}`).toBeTruthy()
      expect(editor[`loudnessFix${m}`], `loudnessFix${m}`).toBeTruthy()
    }
  })

  // The quoted bands have to be the ones lib/quality.ts colours the pills with, or the
  // copy would tell the user one thing while the dot beside the number says another.
  it('quotes the same thresholds the pills grade against', () => {
    expect(editor.loudnessRangeLufs).toContain('-16')
    expect(editor.loudnessRangeLufs).toContain('-8')
    expect(editor.loudnessRangeRange).toContain('6 LU')
    expect(editor.loudnessRangeCrest).toContain('12 dB')
    expect(editor.loudnessRangeBalance).toContain('1 dB')
  })

  // The other half of the request: say plainly when nothing in the app will change a
  // figure, so the user stops hunting for a setting that does not exist. Range, dynamics
  // and the noise floor are properties of the master — normalizing moves the level, not
  // the spread, and Surco does not denoise.
  it('marks the three metrics no setting can change', () => {
    for (const m of ['Range', 'Crest', 'Noise']) {
      expect(editor[`loudnessFix${m}`], `loudnessFix${m}`).toMatch(/not fixable/i)
    }
  })

  it('points the fixable ones at the setting that fixes them', () => {
    expect(editor.loudnessFixDc).toMatch(/DC offset/i)
    expect(editor.loudnessFixLufs).toMatch(/normalization/i)
    expect(editor.loudnessFixBalance).toMatch(/per-channel/i)
  })
})
