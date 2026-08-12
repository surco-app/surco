// Opening the report is the main process's job: it stamps version and OS and hands
// the mailto: straight to the OS. Routing it from here through window.open would
// hit the window's open handler, which only lets http/https through and drops a
// mailto: in silence — the reason reports used to vanish with no window at all.
export function openFeedback(error?: string): void {
  void window.api.openFeedback(error)
}
