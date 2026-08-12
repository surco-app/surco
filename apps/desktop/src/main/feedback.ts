import { app, ipcMain, shell } from 'electron'
import log from 'electron-log/main'

const FEEDBACK_EMAIL = 'hello@vicent.io'

const OS_LABEL: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
}

interface FeedbackContext {
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

// Opens the report in the OS mail client. This deliberately does NOT go through the
// window's open handler: that one only lets http/https reach the OS (see
// navigation.ts), so a mailto: was denied there in silence and every report a user
// sent went nowhere. A machine with no mail client rejects the open, which is
// logged rather than thrown so a failed report can't take the IPC call down.
export async function openFeedbackMail(
  context: FeedbackContext,
  openExternal: (url: string) => Promise<void> = shell.openExternal,
): Promise<void> {
  try {
    await openExternal(buildFeedbackMailto(context))
  } catch (err) {
    log.warn('feedback: could not open mail client', err)
  }
}

// The renderer names only the error text, never the URL, so the navigation guard
// stays strict: version and platform are read here and a compromised renderer has
// no way to point this at a scheme of its choosing.
export function registerFeedbackIpc(): void {
  ipcMain.handle('feedback:open', (_e, error?: string) =>
    openFeedbackMail({ version: app.getVersion(), platform: process.platform, error }),
  )
}
