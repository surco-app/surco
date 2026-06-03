const FEEDBACK_EMAIL = 'hello@vicent.io'

const OS_LABEL: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
}

export interface FeedbackContext {
  version: string
  platform: string
  error?: string
}

// Builds a mailto: link to the feedback inbox, prefilled with the app version and
// OS so a report is actionable without the user digging anything up. When a
// failure is being reported the error rides along too.
export function buildFeedbackMailto({ version, platform, error }: FeedbackContext): string {
  const os = OS_LABEL[platform] ?? platform
  const subject = `[Surco ${version}] ${error ? 'Fallo' : 'Comentarios'}`
  const lines = ['--- no borres esto ---', `Versión: ${version}`, `Sistema: ${os}`]
  if (error) lines.push(`Error: ${error}`)
  lines.push('----------------------', '', '')
  const body = lines.join('\n')
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

// window.open routes the mailto to the system mail client via the main process
// (setWindowOpenHandler → shell.openExternal), the same path external links take.
export function openFeedback(error?: string): void {
  window.open(
    buildFeedbackMailto({ version: window.api.version, platform: window.api.platform, error }),
  )
}
