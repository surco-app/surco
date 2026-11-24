export function menuStep(key: string, current: number, count: number): number | null {
  if (key === 'ArrowDown') return current < count - 1 ? current + 1 : 0
  if (key === 'ArrowUp') return current > 0 ? current - 1 : count - 1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}
