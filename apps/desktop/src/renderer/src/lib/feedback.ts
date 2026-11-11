type FeedbackOpener = (error?: string, stack?: string) => void

let opener: FeedbackOpener | null = null

export function onFeedbackRequested(open: FeedbackOpener): () => void {
  opener = open
  return () => {
    if (opener === open) opener = null
  }
}

export function openFeedback(error?: string, stack?: string): void {
  opener?.(error, stack)
}
