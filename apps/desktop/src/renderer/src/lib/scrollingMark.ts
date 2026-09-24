// How long a pane stays marked after its last scroll event: long enough to read where you
// landed, short enough that the bar is gone by the time you look back at the content.
export const SCROLL_MARK_MS = 900

// Marks whichever pane is scrolling with data-scrolling and clears it once the pane has been
// still for SCROLL_MARK_MS; index.css paints the scrollbar thumb only on marked panes. Scroll
// events don't bubble, so one capturing listener on the document sees every pane.
export function installScrollingMark(doc: Document): () => void {
  const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()
  const onScroll = (e: Event): void => {
    const pane = e.target
    if (!(pane instanceof HTMLElement)) return
    pane.dataset.scrolling = ''
    clearTimeout(timers.get(pane))
    timers.set(
      pane,
      setTimeout(() => {
        delete pane.dataset.scrolling
      }, SCROLL_MARK_MS),
    )
  }
  doc.addEventListener('scroll', onScroll, true)
  return () => doc.removeEventListener('scroll', onScroll, true)
}
