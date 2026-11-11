export const FEEDBACK_FROM = 'Surco <comentarios@getsurco.app>'
export const FEEDBACK_TO = 'hello@vicent.io'
export const MAX_BODY_BYTES = 64 * 1024

const RESEND_URL = 'https://api.resend.com/emails'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const OS_LABEL: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

interface Feedback {
  email: string
  message: string
  version: string
  platform: string
  error?: string
  stack?: string
  logLines: string[]
}

interface Deps {
  apiKey: string | undefined
  send: typeof fetch
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parse(raw: unknown): Feedback | null {
  if (typeof raw !== 'object' || raw === null) return null
  const body = raw as Record<string, unknown>
  const email = text(body.email)
  const message = text(body.message)
  const error = text(body.error) || undefined
  if (!EMAIL.test(email) || (!message && !error)) return null
  const logLines = Array.isArray(body.logLines)
    ? body.logLines.filter((line): line is string => typeof line === 'string')
    : []
  return {
    email,
    message,
    version: text(body.version) || '?',
    platform: text(body.platform),
    error,
    stack: text(body.stack) || undefined,
    logLines,
  }
}

function subject({ version, error, message }: Feedback): string {
  const headline = (error ?? message.split('\n')[0]).replace(/[\r\n]+/g, ' ').trim()
  return `[Surco ${version}] ${headline}`.slice(0, 120)
}

function body(feedback: Feedback): string {
  const os = OS_LABEL[feedback.platform] ?? feedback.platform
  const sections = [
    feedback.message || '(sin mensaje)',
    `Surco ${feedback.version} · ${os}\nResponder a ${feedback.email}`,
  ]
  if (feedback.error) sections.push(`Error\n${feedback.error}`)
  if (feedback.stack) sections.push(`Stack\n${feedback.stack}`)
  if (feedback.logLines.length) sections.push(`Log\n${feedback.logLines.join('\n')}`)
  return sections.join('\n\n')
}

export async function handleFeedback(request: Request, { apiKey, send }: Deps): Promise<Response> {
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 })
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return new Response(null, { status: 400 })
  }
  if (text((json as Record<string, unknown> | null)?.website)) {
    return new Response(null, { status: 204 })
  }
  const feedback = parse(json)
  if (!feedback) return new Response(null, { status: 400 })
  if (!apiKey) return new Response(null, { status: 503 })

  try {
    const res = await send(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: FEEDBACK_FROM,
        to: [FEEDBACK_TO],
        reply_to: feedback.email,
        subject: subject(feedback),
        text: body(feedback),
      }),
    })
    return new Response(null, { status: res.ok ? 204 : 502 })
  } catch {
    return new Response(null, { status: 502 })
  }
}
