import type { DjProgram } from '../../../shared/djProgram'
import { TRAKTOR_BUILT_IN, TRAKTOR_HISTORY } from '../../../shared/traktorContent'
import type {
  CollectionTrack,
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
  collection?(): Promise<CollectionTrack[]>
}

function sourceRead(p: DjProgram, has: { collection: boolean }): SourceRead {
  return {
    available: () => window.api.dj.available(p),
    tree: () => window.api.dj.tree(p),
    recentCount: () => window.api.dj.recentCount(p),
    trackCount: () => window.api.dj.trackCount(p),
    playlist: (id) => window.api.dj.playlist(p, id),
    membership: (paths) => window.api.dj.membership(p, paths),
    ...(has.collection && { collection: () => window.api.dj.collection(p) }),
  }
}

export const SOURCE_READ: Record<DjProgram, SourceRead> = {
  rekordbox: sourceRead('rekordbox', { collection: true }),
  traktor: sourceRead('traktor', { collection: true }),
  engine: sourceRead('engine', { collection: false }),
  serato: sourceRead('serato', { collection: true }),
}

export type EditMessagePrefix = 'sources.edit.' | 'sources.editTraktor.' | 'sources.editSerato.'

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
  crates: boolean
}

export const SOURCE_PROGRAMS: {
  [P in DjProgram]: SourceProgram & { usb: P extends UsbProgram ? true : false }
} = {
  rekordbox: {
    separator: () => window.api.dj.hasSeparator('rekordbox'),
    edit: {
      save: (edit, label) => window.api.dj.editPlaylist('rekordbox', edit, label),
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
    crates: false,
  },
  traktor: {
    separator: () => window.api.dj.hasSeparator('traktor'),
    edit: {
      save: (edit, label) => window.api.dj.editPlaylist('traktor', edit, label),
      messagePrefix: 'sources.editTraktor.',
      gate: 'traktorCollection',
    },
    fixedNode: (node, atRoot) =>
      !atRoot || !TRAKTOR_BUILT_IN.has(node.name)
        ? null
        : node.name === TRAKTOR_HISTORY
          ? 'locked'
          : 'tracks-only',
    usb: true,
    missingLibraryCheck: false,
    trackFlag: 'fromTraktor',
    fillsLoaded: false,
    addsUncollected: false,
    fieldTestIdPrefix: 'traktor-',
    membershipKey: 'traktor-membership',
    invalidatesOnEdit: true,
    crates: false,
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
    crates: false,
  },
  serato: {
    separator: null,
    edit: {
      save: (edit, label) => window.api.dj.editPlaylist('serato', edit, label),
      messagePrefix: 'sources.editSerato.',
      gate: 'none',
    },
    fixedNode: null,
    usb: true,
    missingLibraryCheck: false,
    trackFlag: 'fromSerato',
    fillsLoaded: false,
    addsUncollected: true,
    fieldTestIdPrefix: 'serato-',
    membershipKey: 'serato-membership',
    invalidatesOnEdit: true,
    crates: true,
  },
}

export function isUsbProgram(program: DjProgram): program is UsbProgram {
  return SOURCE_PROGRAMS[program].usb
}
