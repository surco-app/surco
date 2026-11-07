const removed = new Set<string>()

export function markOwnRemovals(ids: readonly string[]): void {
  for (const id of ids) removed.add(id)
}

export function takeOwnRemoval(id: string): boolean {
  return removed.delete(id)
}
