import type { PlaylistRole } from '../../../shared/sessionTypes'
import type { SourceNode } from '../../../shared/types'

const SEPARATOR = /^[-_=*~.\s]+$/

function isSeparator(node: SourceNode): boolean {
  return node.kind === 'playlist' && node.name.length > 0 && SEPARATOR.test(node.name)
}

export function withoutSeparators(nodes: readonly SourceNode[]): SourceNode[] {
  return nodes
    .filter((node) => !isSeparator(node))
    .map((node) => (node.children ? { ...node, children: withoutSeparators(node.children) } : node))
}

const ROLE_WORDS: Readonly<Record<PlaylistRole, readonly string[]>> = {
  base: [
    'base',
    'bases',
    'instrumental',
    'instrumentals',
    'instrumentales',
    'instrumentais',
    'instrumentaux',
    'ベース',
    'インスト',
  ],
  vocal: [
    'cantadita',
    'cantaditas',
    'cantada',
    'cantadas',
    'cantado',
    'cantados',
    'vocal',
    'vocals',
    'vocales',
    'vocais',
    'voix',
    'chant',
    'chants',
    'gesang',
    'acapella',
    'acapellas',
    'acapela',
    'acapelas',
    'ボーカル',
    'ヴォーカル',
  ],
  any: [
    'combo',
    'combos',
    'set',
    'sets',
    'setlist',
    'setlists',
    'tracklist',
    'tracklists',
    'bolo',
    'bolos',
    'gig',
    'gigs',
    'session',
    'sessions',
    'sesion',
    'sesiones',
    'セット',
    'トラックリスト',
  ],
}

function wordsOf(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
}

const WORD_ROLE = new Map<string, PlaylistRole>(
  (Object.entries(ROLE_WORDS) as [PlaylistRole, readonly string[]][]).flatMap(([role, words]) =>
    words.flatMap(wordsOf).map((word) => [word, role] as const),
  ),
)

function roleOfFolderName(node: SourceNode): PlaylistRole | null {
  if (node.kind !== 'folder') return null
  const found = new Set<PlaylistRole>()
  for (const word of wordsOf(node.name)) {
    const role = WORD_ROLE.get(word)
    if (role) found.add(role)
  }
  return found.size === 1 ? ([...found][0] as PlaylistRole) : null
}

export function suggestRoles(
  nodes: readonly SourceNode[],
  inherited: PlaylistRole | null = null,
): Record<string, PlaylistRole> {
  const roles: Record<string, PlaylistRole> = {}
  for (const node of nodes) {
    const role = inherited ?? roleOfFolderName(node)
    if (node.kind === 'playlist' && role) roles[node.id] = role
    Object.assign(roles, suggestRoles(node.children ?? [], role))
  }
  return roles
}

export function suggestedFolderNames(nodes: readonly SourceNode[], inherited = false): string[] {
  return nodes.flatMap((node) => {
    const named = !inherited && roleOfFolderName(node) !== null
    return [
      ...(named ? [node.name] : []),
      ...suggestedFolderNames(node.children ?? [], inherited || named),
    ]
  })
}

export function libraryRoles(
  nodes: readonly SourceNode[],
): Record<string, Exclude<PlaylistRole, 'any'>> {
  const roles: Record<string, Exclude<PlaylistRole, 'any'>> = {}
  for (const [id, role] of Object.entries(suggestRoles(nodes))) {
    if (role !== 'any') roles[id] = role
  }
  return roles
}
