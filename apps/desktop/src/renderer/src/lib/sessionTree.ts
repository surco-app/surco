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
