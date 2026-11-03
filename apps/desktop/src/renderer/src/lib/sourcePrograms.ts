import type { DjProgram } from '../../../shared/djProgram'
import { TRAKTOR_BUILT_IN, TRAKTOR_HISTORY } from '../../../shared/traktorContent'
import type {
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  SourceNode,
  SourcePlaylistEntry,
  UsbProgram,
} from '../../../shared/types'
import type { TrackFlag } from './trackPrograms'

export interface SourceRead {
  available(): Promise<boolean>
  tree(): Promise<SourceNode[]>
  recentCount(): Promise<number>
  trackCount(): Promise<number>
  playlist(id: string): Promise<SourcePlaylistEntry[]>
  membership(paths: string[]): Promise<Record<string, string[]>>
}

export const SOURCE_READ: Record<DjProgram, SourceRead> = {
  rekordbox: {
    available: () => window.api.rekordboxAvailable(),
    tree: () => window.api.loadRekordboxTree(),
    recentCount: () => window.api.rekordboxRecentCount(),
    trackCount: () => window.api.rekordboxTrackCount(),
    playlist: (id) => window.api.loadRekordboxPlaylist(id),
    membership: (paths) => window.api.rekordboxMembership(paths),
  },
  traktor: {
    available: () => window.api.traktorAvailable(),
    tree: () => window.api.loadTraktorTree(),
    recentCount: () => window.api.traktorRecentCount(),
    trackCount: () => window.api.traktorTrackCount(),
    playlist: (id) => window.api.loadTraktorPlaylist(id),
    membership: (paths) => window.api.traktorMembership(paths),
  },
  engine: {
    available: () => window.api.engineAvailable(),
    tree: () => window.api.loadEngineTree(),
    recentCount: () => window.api.engineRecentCount(),
    trackCount: () => window.api.engineTrackCount(),
    playlist: (id) => window.api.loadEnginePlaylist(id),
    membership: (paths) => window.api.engineMembership(paths),
  },
}

export type EditMessagePrefix = 'sources.edit.' | 'sources.editTraktor.'

export interface SourceEdit {
  save(edit: RekordboxPlaylistEdit, label?: string): Promise<RekordboxEditResult>
  messagePrefix: EditMessagePrefix
  gate: 'none' | 'traktorCollection'
}

export type FixedNode = 'locked' | 'tracks-only' | null

export interface SourceProgram {
  separator: (() => Promise<boolean>) | null
  edit: SourceEdit | null
  fixedNode: ((node: SourceNode, atRoot: boolean) => FixedNode) | null
  usb: boolean
  missingLibraryCheck: boolean
  trackFlag: TrackFlag | null
  fillsLoaded: boolean
  addsUncollected: boolean
  fieldTestIdPrefix: string
  membershipKey: string
  invalidatesOnEdit: boolean
}

export const SOURCE_PROGRAMS: {
  [P in DjProgram]: SourceProgram & { usb: P extends UsbProgram ? true : false }
} = {
  rekordbox: {
    separator: () => window.api.rekordboxHasSeparator(),
    edit: {
      save: (edit, label) => window.api.editRekordboxPlaylist(edit, label),
      messagePrefix: 'sources.edit.',
      gate: 'none',
    },
    fixedNode: null,
    usb: true,
    missingLibraryCheck: false,
    trackFlag: 'fromRekordbox',
    fillsLoaded: true,
    addsUncollected: true,
    fieldTestIdPrefix: '',
    membershipKey: 'rekordbox-membership',
    invalidatesOnEdit: true,
  },
  traktor: {
    separator: () => window.api.traktorHasSeparator(),
    edit: {
      save: (edit, label) => window.api.editTraktorPlaylist(edit, label),
      messagePrefix: 'sources.editTraktor.',
      gate: 'traktorCollection',
    },
    fixedNode: (node, atRoot) =>
      !atRoot || !TRAKTOR_BUILT_IN.has(node.name)
        ? null
        : node.name === TRAKTOR_HISTORY
          ? 'locked'
          : 'tracks-only',
    usb: false,
    missingLibraryCheck: false,
    trackFlag: 'fromTraktor',
    fillsLoaded: false,
    addsUncollected: false,
    fieldTestIdPrefix: 'traktor-',
    membershipKey: 'traktor-membership',
    invalidatesOnEdit: true,
  },
  engine: {
    separator: null,
    edit: null,
    fixedNode: null,
    usb: true,
    missingLibraryCheck: true,
    trackFlag: null,
    fillsLoaded: false,
    addsUncollected: false,
    fieldTestIdPrefix: 'engine-',
    membershipKey: 'engine-membership',
    invalidatesOnEdit: false,
  },
}

export function isUsbProgram(program: DjProgram): program is UsbProgram {
  return SOURCE_PROGRAMS[program].usb
}
