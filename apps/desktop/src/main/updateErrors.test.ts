import { describe, expect, it } from 'vitest'
import { classifyUpdateError, summarizeUpdateError } from './updateErrors'

// electron-updater's HttpError carries the response status as `statusCode`.
function httpError(statusCode: number): Error {
  return Object.assign(new Error(`HttpError: ${statusCode}`), { statusCode })
}

function codeError(code: string): Error {
  return Object.assign(new Error(`request failed: ${code}`), { code })
}

describe('classifyUpdateError', () => {
  // A 504 from GitHub's feed is GitHub's problem, not the user's: it must route to
  // the silent retry loop, never to an immediate toast.
  it('classifies server errors and rate limits as transient', () => {
    expect(classifyUpdateError(httpError(504))).toEqual({ kind: 'transient', status: 504 })
    expect(classifyUpdateError(httpError(500))).toEqual({ kind: 'transient', status: 500 })
    expect(classifyUpdateError(httpError(429))).toEqual({ kind: 'transient', status: 429 })
  })

  // A 404 means the feed itself is wrong (bad repo, unpublished release) — retrying
  // won't fix it, so the user must hear about it.
  it('classifies other HTTP statuses as fatal but keeps the status', () => {
    expect(classifyUpdateError(httpError(404))).toEqual({ kind: 'fatal', status: 404 })
    expect(classifyUpdateError(httpError(403))).toEqual({ kind: 'fatal', status: 403 })
  })

  // Checking for updates on a train without wifi is normal life, not an incident:
  // offline gets its own kind so the scheduler can retry without ever toasting.
  it('classifies no-connectivity failures as offline', () => {
    expect(classifyUpdateError(codeError('ENOTFOUND')).kind).toBe('offline')
    expect(classifyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED')).kind).toBe('offline')
    expect(classifyUpdateError(new Error('net::ERR_NAME_NOT_RESOLVED')).kind).toBe('offline')
  })

  it('classifies flaky-network failures as transient', () => {
    expect(classifyUpdateError(codeError('ETIMEDOUT')).kind).toBe('transient')
    expect(classifyUpdateError(codeError('ECONNRESET')).kind).toBe('transient')
    expect(classifyUpdateError(new Error('net::ERR_CONNECTION_TIMED_OUT')).kind).toBe('transient')
  })

  // Anything unrecognized (signature mismatch, corrupt download…) must surface
  // immediately rather than being retried forever in silence.
  it('classifies unknown errors as fatal', () => {
    expect(classifyUpdateError(new Error('code signature did not match'))).toEqual({
      kind: 'fatal',
      status: null,
    })
    expect(classifyUpdateError('boom')).toEqual({ kind: 'fatal', status: null })
  })
})

describe('summarizeUpdateError', () => {
  // The whole point of the change: the 504 toast used to dump the request method,
  // URL, HTML body and headers on the user. Only a short first line may survive.
  it('keeps only the first line, truncated', () => {
    const dump = `method: GET url: https://github.com/surco-app/surco-releases/releases.atom\n\nData:\n<html><body><h1>504 Gateway Time-out</h1></body></html>`
    const summary = summarizeUpdateError(new Error(dump))
    expect(summary).not.toContain('<html>')
    expect(summary).not.toContain('\n')
    expect(summary.length).toBeLessThanOrEqual(120)
  })

  it('stringifies non-Error values', () => {
    expect(summarizeUpdateError('boom')).toBe('boom')
  })
})
