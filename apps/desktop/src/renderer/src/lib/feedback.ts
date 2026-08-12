// Opening the report is the main process's job: it stamps version and OS, attaches
// the recent log errors and hands the issue URL straight to the OS. Routing it from
// here through window.open would hit the window's open handler, which drops anything
// the renderer names that isn't http/https — the reason reports used to vanish with
// no window at all.
export function openFeedback(error?: string, stack?: string): void {
  void window.api.openFeedback(error, stack)
}
