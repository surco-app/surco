import type { SessionAnswers, SessionHarmony, SessionWizardSettings } from './sessionTypes'

export const DEFAULT_SESSION_WIZARD: SessionWizardSettings = {
  minutes: 90,
  playMinutes: 2,
  freshShare: 0.15,
  preferCombos: true,
  harmony: 'free',
  tasteWeight: true,
  alternate: true,
  surprise: false,
}

const HARMONIES: readonly SessionHarmony[] = ['free', 'neighbours', 'same']
const MAX_FRESH_SHARE = 0.4
const MIN_PLAY_MINUTES = 1
const MAX_PLAY_MINUTES = 10

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function answersFromSettings(wizard: SessionWizardSettings): SessionAnswers {
  return { ...wizard, sources: [], fresh: [] }
}

export function wizardSettingsFrom(
  answers: SessionAnswers,
  previous: SessionWizardSettings,
): SessionWizardSettings {
  return {
    minutes: answers.minutes,
    playMinutes: answers.playMinutes,
    freshShare: answers.fresh.length > 0 ? answers.freshShare : previous.freshShare,
    preferCombos: answers.preferCombos,
    harmony: answers.harmony,
    tasteWeight: answers.tasteWeight,
    alternate: answers.alternate,
    surprise: answers.surprise,
  }
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeSessionWizard(raw: unknown): SessionWizardSettings {
  const saved = isRecord(raw) ? raw : {}
  const minutes = saved.minutes
  const share = saved.freshShare
  const play = saved.playMinutes
  return {
    minutes:
      typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
        ? Math.round(minutes)
        : DEFAULT_SESSION_WIZARD.minutes,
    playMinutes:
      typeof play === 'number' && Number.isFinite(play)
        ? Math.min(MAX_PLAY_MINUTES, Math.max(MIN_PLAY_MINUTES, Math.round(play)))
        : DEFAULT_SESSION_WIZARD.playMinutes,
    freshShare:
      typeof share === 'number' && Number.isFinite(share)
        ? Math.min(MAX_FRESH_SHARE, Math.max(0, share))
        : DEFAULT_SESSION_WIZARD.freshShare,
    preferCombos: flag(saved.preferCombos, DEFAULT_SESSION_WIZARD.preferCombos),
    harmony: HARMONIES.includes(saved.harmony as SessionHarmony)
      ? (saved.harmony as SessionHarmony)
      : DEFAULT_SESSION_WIZARD.harmony,
    tasteWeight: flag(saved.tasteWeight, DEFAULT_SESSION_WIZARD.tasteWeight),
    alternate: flag(saved.alternate, DEFAULT_SESSION_WIZARD.alternate),
    surprise: flag(saved.surprise, DEFAULT_SESSION_WIZARD.surprise),
  }
}
