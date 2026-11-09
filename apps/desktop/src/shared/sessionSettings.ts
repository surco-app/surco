import type { PlaylistRole, SessionHarmony, SessionWizardSettings } from './sessionTypes'

export const DEFAULT_SESSION_WIZARD: SessionWizardSettings = {
  minutes: 90,
  freshShare: 0.15,
  preferCombos: true,
  harmony: 'free',
  tasteWeight: true,
  alternate: true,
  surprise: false,
}

const ROLES: readonly PlaylistRole[] = ['base', 'vocal', 'any', 'set']
const HARMONIES: readonly SessionHarmony[] = ['free', 'neighbours', 'same']
const KEY_PROGRAMS = ['rekordbox', 'traktor', 'engine', 'serato']
const MAX_FRESH_SHARE = 0.4

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validKey(key: string): boolean {
  const colon = key.indexOf(':')
  return colon > 0 && colon < key.length - 1 && KEY_PROGRAMS.includes(key.slice(0, colon))
}

export function normalizeSessionRoles(raw: unknown): Record<string, PlaylistRole> {
  if (!isRecord(raw)) return {}
  const roles: Record<string, PlaylistRole> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (validKey(key) && ROLES.includes(value as PlaylistRole)) roles[key] = value as PlaylistRole
  }
  return roles
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeSessionWizard(raw: unknown): SessionWizardSettings {
  const saved = isRecord(raw) ? raw : {}
  const minutes = saved.minutes
  const share = saved.freshShare
  return {
    minutes:
      typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
        ? Math.round(minutes)
        : DEFAULT_SESSION_WIZARD.minutes,
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
