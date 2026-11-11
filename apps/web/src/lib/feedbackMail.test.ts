import { describe, expect, it, vi } from 'vitest'
import { FEEDBACK_FROM, FEEDBACK_TO, handleFeedback, MAX_BODY_BYTES } from './feedbackMail'

const valid = {
  email: 'djotas@example.com',
  message: 'Al convertir a AIFF desde el NAS se queda parado',
  version: '1.32.1',
  platform: 'win32',
}

function post(body: unknown): Request {
  return new Request('https://getsurco.app/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function accepted(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async () => new Response('{"id":"x"}', { status: 200 }))
}

function sentPayload(send: ReturnType<typeof accepted>): Record<string, unknown> {
  const init = send.mock.calls[0][1] as RequestInit
  return JSON.parse(init.body as string)
}

describe('handleFeedback', () => {
  it('forwards a report to the inbox with the sender as reply-to so a reply reaches the user', async () => {
    const send = accepted()
    const res = await handleFeedback(post(valid), { apiKey: 'k', send })

    expect(res.status).toBe(204)
    const [url, init] = send.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer k' })
    const payload = sentPayload(send)
    expect(payload.from).toBe(FEEDBACK_FROM)
    expect(payload.to).toEqual([FEEDBACK_TO])
    expect(payload.reply_to).toBe('djotas@example.com')
    expect(payload.text).toContain('Al convertir a AIFF desde el NAS se queda parado')
    expect(payload.text).toContain('1.32.1')
    expect(payload.text).toContain('Windows')
  })

  it('carries the error, stack and log lines a report from a failure brings along', async () => {
    const send = accepted()
    await handleFeedback(
      post({
        ...valid,
        message: '',
        error: 'Invalid data found when processing input',
        stack: 'at convert (main.js:1)',
        logLines: ['[error] ffmpeg exited with 1'],
      }),
      { apiKey: 'k', send },
    )
    const payload = sentPayload(send)
    expect(payload.subject).toBe('[Surco 1.32.1] Invalid data found when processing input')
    expect(payload.text).toContain('at convert (main.js:1)')
    expect(payload.text).toContain('[error] ffmpeg exited with 1')
  })

  it('titles a plain comment with its first line so the inbox reads at a glance', async () => {
    const send = accepted()
    await handleFeedback(post({ ...valid, message: 'Primera línea\nsegunda' }), {
      apiKey: 'k',
      send,
    })
    expect(sentPayload(send).subject).toBe('[Surco 1.32.1] Primera línea')
  })

  it('rejects a report without a valid email, since the user cannot be answered', async () => {
    const send = accepted()
    for (const email of ['', 'sin-arroba', 'a@b', undefined]) {
      const res = await handleFeedback(post({ ...valid, email }), { apiKey: 'k', send })
      expect(res.status).toBe(400)
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects an empty report that carries neither a message nor an error', async () => {
    const send = accepted()
    const res = await handleFeedback(post({ ...valid, message: '  ' }), { apiKey: 'k', send })
    expect(res.status).toBe(400)
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON instead of throwing', async () => {
    const res = await handleFeedback(post('no es json'), { apiKey: 'k', send: accepted() })
    expect(res.status).toBe(400)
  })

  it('refuses an oversized body so the endpoint cannot be used to mail megabytes', async () => {
    const send = accepted()
    const res = await handleFeedback(post({ ...valid, message: 'x'.repeat(MAX_BODY_BYTES) }), {
      apiKey: 'k',
      send,
    })
    expect(res.status).toBe(413)
    expect(send).not.toHaveBeenCalled()
  })

  it('answers a bot that filled the hidden field as if it worked, without mailing anything', async () => {
    const send = accepted()
    const res = await handleFeedback(post({ ...valid, website: 'http://spam' }), {
      apiKey: 'k',
      send,
    })
    expect(res.status).toBe(204)
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps a line break in the user text out of the subject header', async () => {
    const send = accepted()
    await handleFeedback(post({ ...valid, message: '', error: 'boom\r\nBcc: x@y.z' }), {
      apiKey: 'k',
      send,
    })
    expect(sentPayload(send).subject).not.toMatch(/[\r\n]/)
  })

  it('reports a provider failure as 502 so the app offers to retry', async () => {
    const send = vi.fn<typeof fetch>(async () => new Response('{}', { status: 500 }))
    const res = await handleFeedback(post(valid), { apiKey: 'k', send })
    expect(res.status).toBe(502)
  })

  it('reports an unreachable provider as 502 rather than crashing the function', async () => {
    const send = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed')
    })
    const res = await handleFeedback(post(valid), { apiKey: 'k', send })
    expect(res.status).toBe(502)
  })

  it('fails with 503 when the key is missing, never pretending the report went out', async () => {
    const send = accepted()
    const res = await handleFeedback(post(valid), { apiKey: undefined, send })
    expect(res.status).toBe(503)
    expect(send).not.toHaveBeenCalled()
  })
})
