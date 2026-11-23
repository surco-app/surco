import { type RefObject, useLayoutEffect, useState } from 'react'

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

export function useFoldedMarks(ref: RefObject<HTMLElement | null>, marksKey: string): string[] {
  const [folded, setFolded] = useState<string[]>([])
  // biome-ignore lint/correctness/useExhaustiveDependencies: marksKey is the re-run trigger for a mark that comes or goes without the box changing size; the marks are read from the DOM.
  useLayoutEffect(() => {
    const row = ref.current
    if (!row) return
    const measure = (): void => {
      const marks = [...row.children] as HTMLElement[]
      const next =
        marks.length < 2 || row.clientHeight === 0
          ? []
          : marks
              .filter((m) => m.offsetTop >= row.clientHeight)
              .map((m) => m.getAttribute('data-mark-label') ?? '')
              .filter((label) => label !== '')
      setFolded((prev) => (sameList(prev, next) ? prev : next))
    }
    measure()
    if (row.children.length < 2 || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [ref, marksKey])
  return folded
}
