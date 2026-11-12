import type { DjProgram } from '../../../shared/djProgram'
import { TRAKTOR_BUILT_IN, TRAKTOR_HISTORY } from '../../../shared/traktorContent'
import type {
  CollectionTrack,
  PlaylistEditMode,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  SourceNode,
  SourcePlaylistEntry,
  UsbProgram,
} from '../../../shared/types'

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
  virtualdj: sourceRead('virtualdj', { collection: true }),
}

export type EditMessagePrefix =
  | 'sources.edit.'
  | 'sources.editTraktor.'
  | 'sources.editSerato.'
  | 'sources.editEngine.'
  | 'sources.editVirtualdj.'

export interface SourceEdit {
  save(
    edit: RekordboxPlaylistEdit,
    label?: string,
    mode?: PlaylistEditMode,
  ): Promise<RekordboxEditResult>
  messagePrefix: EditMessagePrefix
  gate: 'none' | 'traktorCollection'
  kinds?: ReadonlySet<RekordboxPlaylistEdit['kind']>
  folders?: false
}

export type FixedNode = 'locked' | 'tracks-only' | null

export interface SourceProgram {
  separator: (() => Promise<boolean>) | null
  edit: SourceEdit | null
  fixedNode: ((node: SourceNode, atRoot: boolean) => FixedNode) | null
  usb: boolean
  missingLibraryCheck: boolean
  marksOrigin: boolean
  fillsLoaded: boolean
  addsUncollected: boolean
  fieldTestIdPrefix: string
  membershipKey: string
  invalidatesOnEdit: boolean
  crates: boolean
  idJoin: string | null
}

export const SOURCE_PROGRAMS: {
  [P in DjProgram]: SourceProgram & { usb: P extends UsbProgram ? true : false }
} = {
  rekordbox: {
    separator: () => window.api.dj.hasSeparator('rekordbox'),
    edit: {
      save: (...args) => window.api.dj.editPlaylist('rekordbox', ...args),
      messagePrefix: 'sources.edit.',
      gate: 'none',
    },
    fixedNode: null,
    usb: true,
    missingLibraryCheck: false,
    marksOrigin: true,
    fillsLoaded: true,
    addsUncollected: true,
    fieldTestIdPrefix: '',
    membershipKey: 'rekordbox-membership',
    invalidatesOnEdit: true,
    crates: false,
    idJoin: null,
  },
  traktor: {
    separator: () => window.api.dj.hasSeparator('traktor'),
    edit: {
      save: (...args) => window.api.dj.editPlaylist('traktor', ...args),
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
    marksOrigin: true,
    fillsLoaded: false,
    addsUncollected: false,
    fieldTestIdPrefix: 'traktor-',
    membershipKey: 'traktor-membership',
    invalidatesOnEdit: true,
    crates: false,
    idJoin: null,
  },
  engine: {
    separator: null,
    edit: {
      save: (...args) => window.api.dj.editPlaylist('engine', ...args),
      messagePrefix: 'sources.editEngine.',
      gate: 'none',
      kinds: new Set(['create', 'add', 'delete']),
      folders: false,
    },
    fixedNode: null,
    usb: true,
    missingLibraryCheck: true,
    marksOrigin: false,
    fillsLoaded: false,
    addsUncollected: false,
    fieldTestIdPrefix: 'engine-',
    membershipKey: 'engine-membership',
    invalidatesOnEdit: true,
    crates: false,
    idJoin: null,
  },
  serato: {
    separator: null,
    edit: {
      save: (...args) => window.api.dj.editPlaylist('serato', ...args),
      messagePrefix: 'sources.editSerato.',
      gate: 'none',
    },
    fixedNode: null,
    usb: true,
    missingLibraryCheck: false,
    marksOrigin: true,
    fillsLoaded: false,
    addsUncollected: true,
    fieldTestIdPrefix: 'serato-',
    membershipKey: 'serato-membership',
    invalidatesOnEdit: true,
    crates: true,
    idJoin: '%%',
  },
  virtualdj: {
    separator: null,
    edit: {
      save: (...args) => window.api.dj.editPlaylist('virtualdj', ...args),
      messagePrefix: 'sources.editVirtualdj.',
      gate: 'none',
    },
    fixedNode: null,
    usb: true,
    missingLibraryCheck: false,
    marksOrigin: true,
    fillsLoaded: false,
    addsUncollected: true,
    fieldTestIdPrefix: 'virtualdj-',
    membershipKey: 'virtualdj-membership',
    invalidatesOnEdit: true,
    crates: false,
    idJoin: '/',
  },
}

export function isUsbProgram(program: DjProgram): program is UsbProgram {
  return SOURCE_PROGRAMS[program].usb
}
