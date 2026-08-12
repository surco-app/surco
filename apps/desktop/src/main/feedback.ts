import { readFile } from 'node:fs/promises'
import { app, ipcMain, shell } from 'electron'
import log from 'electron-log/main'
import { recentErrorLines } from './errorReport'

const ISSUE_URL = 'https://github.com/surco-app/surco/issues/new'

// GitHub answers 414 past roughly 8 KB of URL and the user gets a browser error page
// instead of the issue form, so the body is trimmed to fit rather than risk the whole
// report bouncing.
export const MAX_URL_LENGTH = 7500

// How many [error] lines ride along. A typical log holds a handful; the cap bounds
// what a pathological one could push into the URL.
const REPORT_LOG_LINES = 40

const OS_LABEL: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
}

interface FeedbackContext {
  version: string
  platform: string
  error?: string
  stack?: string
  // Recent [error] lines, already stripped of directory paths by errorReport.ts —
  // this body becomes a public issue.
  logLines?: string[]
}

function buildBody({ version, platform, error, stack, logLines }: FeedbackContext): string {
  const os = OS_LABEL[platform] ?? platform
  const sections = [
    '### Qué pasó\n\n<!-- Cuéntanos qué estabas haciendo. -->\n',
    `### Entorno\n\n- Surco: ${version}\n- Sistema: ${os}`,
  ]
  if (error) sections.push(`### Error\n\n\`\`\`\n${error}\n\`\`\``)
  if (stack) sections.push(`### Stack\n\n\`\`\`\n${stack}\n\`\`\``)
  if (logLines?.length) sections.push(`### Log\n\n\`\`\`\n${logLines.join('\n')}\n\`\`\``)
  return sections.join('\n\n')
}

// Cuts the body from the front: the newest log lines sit at the end and describe the
// crash being reported, so an oversized report loses its oldest context, not the part
// that matters. The marker keeps the truncation visible to whoever reads the issue.
function fitToLimit(title: string, body: string): string {
  const withBody = (text: string): string =>
    `${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`
  if (withBody(body).length <= MAX_URL_LENGTH) return withBody(body)
  const marker = '_(log truncado)_\n\n'
  let lo = 0
  let hi = body.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (withBody(marker + body.slice(body.length - mid)).length <= MAX_URL_LENGTH) lo = mid
    else hi = mid - 1
  }
  return withBody(marker + body.slice(body.length - lo))
}

// Builds a prefilled GitHub issue: version, OS and whatever failed, so a report lands
// actionable without the user digging anything up. It replaces a mailto:, which only
// worked for users with a mail client configured — on Windows, typically nobody.
export function buildIssueUrl(ctx: FeedbackContext): string {
  const title = ctx.error ? `[${ctx.version}] ${ctx.error}` : `[${ctx.version}] Comentarios`
  return fitToLimit(title.slice(0, 120), buildBody(ctx))
}

// The failure lines a report carries, read on demand — never at startup, since the log
// can sit on a slow volume.
async function readRecentErrors(): Promise<string[]> {
  const contents = await readFile(log.transports.file.getFile().path, 'utf8')
  return recentErrorLines(contents, REPORT_LOG_LINES)
}

// Opens the report in the browser. This deliberately does NOT go through the window's
// open handler: that one only lets http/https reach the OS (see navigation.ts), and a
// mailto: was denied there in silence — every report a user sent went nowhere. An
// unreadable log costs the log section, not the report; a refused open is logged
// rather than thrown so a failed report can't take the IPC call down.
export async function openFeedbackReport(
  context: FeedbackContext,
  openExternal: (url: string) => Promise<void> = shell.openExternal,
  readErrors: () => Promise<string[]> = readRecentErrors,
): Promise<void> {
  let logLines: string[] = []
  try {
    logLines = await readErrors()
  } catch (err) {
    log.warn('feedback: could not read the log', err)
  }
  try {
    await openExternal(buildIssueUrl({ ...context, logLines }))
  } catch (err) {
    log.warn('feedback: could not open the issue form', err)
  }
}

// The renderer names only the error text and stack, never the URL, so the navigation
// guard stays strict: version and platform are read here and a compromised renderer
// has no way to point this at a scheme of its choosing.
export function registerFeedbackIpc(): void {
  ipcMain.handle('feedback:open', (_e, error?: string, stack?: string) =>
    openFeedbackReport({ version: app.getVersion(), platform: process.platform, error, stack }),
  )
}
