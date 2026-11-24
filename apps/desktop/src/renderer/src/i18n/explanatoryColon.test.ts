import { describe, expect, it } from 'vitest'
import ca from './locales/ca.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import itIT from './locales/it.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const LOCALES = { de, en, es, fr, ja, 'pt-BR': ptBR, ca, it: itIT }

// El tono de Surco no introduce una explicación con dos puntos. Se parte en dos frases o se pone una coma.
// Los dos puntos de etiqueta y valor («Saltada: …», «Omitido: …») se quedan y no están en esta lista.
const WITHOUT_EXPLANATORY_COLON = [
  'header.cancelConvert',
  'header.cancelImport',
  'header.cancelAutoMatch',
  'header.cancelAnalyze',
  'sidebar.positionReveal',
  'errors.engineDjOpen',
  'errors.sourceTagsUnread',
  'errors.pathNotAllowed',
  'rekordboxIssue.read-only',
  'rekordboxIssue.unreadable',
  'rekordboxIssue.write-failed',
  'rekordboxIssue.backup-failed',
  'rekordboxIssue.ambiguous_one',
  'rekordboxIssue.ambiguous_other',
  'engineIssue.unreadable',
  'engineIssue.write-failed',
  'engineIssue.backup-failed',
  'engineIssue.ambiguous_one',
  'engineIssue.ambiguous_other',
  'player.continuousHelp',
  'editor.qualityUpsampled',
  'editor.qualityBitsFull',
  'editor.qualityCaptionTranscode',
  'editor.qualityEvidenceGood',
  'editor.qualityEvidenceTranscode',
  'editor.qualityEvidenceTeeth',
  'editor.qualityEvidenceHump',
  'editor.outputNameHintInPlace',
  'editor.overwriteAlacHint',
  'editor.lossyToLossless',
  'editor.fileInUseError',
  'editor.loudnessFixLufs',
  'editor.loudnessFixPeak',
  'editor.loudnessFixRange',
  'editor.loudnessFixCrest',
  'editor.loudnessFixDc',
  'editor.loudnessFixNoise',
  'editor.cues.twins.left_one',
  'editor.cues.twins.left_other',
  'editor.cues.twins.full_one',
  'editor.cues.twins.full_other',
  'declick.cueWarning',
  'normalize.presetHint.streaming',
  'normalize.presetHint.club',
  'normalize.truePeakCaption',
  'normalize.modeLine.loudness',
  'normalize.plan.gain',
  'normalize.plan.peak',
  'settings.beatportHint',
  'settings.autoMatchNeedsToken',
  'settings.keepMp3SourcesOff',
  'settings.djReachAddHint',
  'settings.customFieldKeyHint',
  'onboarding.intent.metadataBody',
  'copies.state.halted',
]

function lookup(strings: object, key: string): string {
  const flat = strings as Record<string, unknown>
  if (typeof flat[key] === 'string') return flat[key] as string
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], strings) as string
}

describe('messages explain with a second sentence, never with a colon', () => {
  for (const [lang, strings] of Object.entries(LOCALES)) {
    it(`has no explanatory colon in ${lang}`, () => {
      for (const key of WITHOUT_EXPLANATORY_COLON) {
        const message = lookup(strings, key)
        expect(message, `${lang} ${key}`).not.toMatch(/:(\s|$)|：/)
      }
    })
  }
})
