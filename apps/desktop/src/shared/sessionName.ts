import type { SourceNode } from './types'

export function sessionDateLabel(day: Date, locale?: string): string {
  return day.toLocaleDateString(locale, { day: 'numeric', month: 'numeric' }).replaceAll('/', '-')
}

export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}

function find(nodes: readonly SourceNode[], id: string): SourceNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const inside = find(node.children ?? [], id)
    if (inside) return inside
  }
  return null
}

export function childNames(tree: readonly SourceNode[] | undefined, parentId: string): Set<string> {
  if (!tree) return new Set()
  const children = parentId === 'root' ? tree : (find(tree, parentId)?.children ?? [])
  return new Set(children.map((node) => node.name))
}
