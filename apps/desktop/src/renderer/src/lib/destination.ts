import type { Settings } from '../../../shared/types'

export type Location = 'folder' | 'beside' | 'overwrite'

export const LOCATIONS: Location[] = ['folder', 'beside', 'overwrite']

export interface DestinationPlan {
  location: Location
  appleMusic: boolean
  engineDj: boolean
  keepOutputCopy: boolean
}

type DestinationSettings = Pick<
  Settings,
  | 'addToAppleMusic'
  | 'keepOutputCopy'
  | 'overwriteOriginal'
  | 'addToEngineDj'
  | 'convertBesideOriginal'
>

export function planFromSettings(s: DestinationSettings, flac: boolean): DestinationPlan {
  const location: Location = s.overwriteOriginal
    ? 'overwrite'
    : s.convertBesideOriginal
      ? 'beside'
      : 'folder'
  const inFolder = location === 'folder'
  return {
    location,
    appleMusic: inFolder && !flac && s.addToAppleMusic,
    engineDj: inFolder && s.addToEngineDj,
    keepOutputCopy: s.keepOutputCopy,
  }
}

export function planToSettings(p: DestinationPlan): DestinationSettings {
  return {
    addToAppleMusic: p.appleMusic,
    keepOutputCopy: p.keepOutputCopy,
    overwriteOriginal: p.location === 'overwrite',
    addToEngineDj: p.engineDj,
    convertBesideOriginal: p.location === 'beside',
  }
}

export function withLocation(p: DestinationPlan, location: Location): DestinationPlan {
  if (location === 'folder') return { ...p, location }
  return { ...p, location, appleMusic: false, engineDj: false }
}

export function withAppleMusic(p: DestinationPlan, on: boolean): DestinationPlan {
  return on ? { ...p, appleMusic: true, keepOutputCopy: false } : { ...p, appleMusic: false }
}

export function withEngineDj(p: DestinationPlan, on: boolean): DestinationPlan {
  return { ...p, engineDj: on }
}

export function keepsOutputCopy(p: DestinationPlan): boolean {
  return !p.appleMusic || p.engineDj || p.keepOutputCopy
}

export type DjSoftware = 'appleMusic' | 'engineDj' | 'rekordbox' | 'traktor'

export const DJ_SOFTWARE_NAMES: Record<DjSoftware, string> = {
  appleMusic: 'Apple Music',
  engineDj: 'Engine DJ',
  rekordbox: 'rekordbox',
  traktor: 'Traktor',
}
