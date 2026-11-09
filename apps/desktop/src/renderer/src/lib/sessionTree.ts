import type { PlaylistRole } from '../../../shared/sessionTypes'
import type { SourceNode } from '../../../shared/types'
import { foldText } from './normalizeText'

const SEPARATOR = /^[-_=*~.\s]+$/

function isSeparator(node: SourceNode): boolean {
  return node.kind === 'playlist' && node.name.length > 0 && SEPARATOR.test(node.name)
}

export function withoutSeparators(nodes: readonly SourceNode[]): SourceNode[] {
  return nodes
    .filter((node) => !isSeparator(node))
    .map((node) => (node.children ? { ...node, children: withoutSeparators(node.children) } : node))
}

const NAME_ROLES: readonly (readonly [RegExp, PlaylistRole])[] = [
  [/^bases?$/, 'base'],
  [/^(cantaditas?|vocals?|acapellas?)$/, 'vocal'],
  [/^(combos?|sets?|tracklists?|bolos?)$/, 'any'],
]

function roleOfFolderName(node: SourceNode): PlaylistRole | null {
  if (node.kind !== 'folder') return null
  const name = foldText(node.name).trim()
  return NAME_ROLES.find(([pattern]) => pattern.test(name))?.[1] ?? null
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
