const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function tailStart(title: string): number {
  if (!title.endsWith(')')) return -1
  let depth = 0
  for (let i = title.length - 1; i >= 0; i--) {
    if (title[i] === ')') depth++
    else if (title[i] === '(' && --depth === 0) {
      const space = title.lastIndexOf(' ')
      return space >= i - 1 ? space : i
    }
  }
  return -1
}

export function truncateTitleMiddle(
  title: string,
  maxWidth: number,
  measure: (text: string) => number,
): string {
  const start = tailStart(title)
  if (start <= 0 || measure(title) <= maxWidth) return title
  const tail = `…${title.slice(start)}`
  const room = maxWidth - measure(tail)
  let head = ''
  for (const { segment } of segmenter.segment(title.slice(0, start))) {
    if (measure(head + segment) > room) break
    head += segment
  }
  return head === '' ? title : head + tail
}
