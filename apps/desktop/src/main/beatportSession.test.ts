import { describe, expect, it } from 'vitest'
import { errorKeyOf } from '../shared/errorKeys'
import { type BeatportCredentials, createBeatportSession } from './beatportSession'

interface FakeOptions {
  refreshOk?: boolean
  loginThrowsOnce?: boolean
  invalidClientOnce?: boolean
}

function fakeBeatport(options: FakeOptions = {}) {
  const calls: string[] = []
  let loginThrows = options.loginThrowsOnce ?? false
  let invalidClient = options.invalidClientOnce ?? false
  let issued = 0
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const path = new URL(url).pathname
    calls.push(path)
    if (path === '/v4/docs/') return new Response('<script src="/static/btprt/a.js"></script>')
    if (path === '/static/btprt/a.js') return new Response("x={API_CLIENT_ID: 'CID'}")
    if (path === '/v4/auth/login/') {
      if (loginThrows) {
        loginThrows = false
        throw new TypeError('fetch failed')
      }
      const body = JSON.parse(String(init?.body)) as BeatportCredentials
      if (body.username === 'u' && body.password === 'p')
        return new Response('{}', { status: 200, headers: { 'set-cookie': 'sessionid=S; Path=/' } })
      return new Response('"Incorrect username or password."', { status: 403 })
    }
    if (path === '/v4/auth/o/authorize/') {
      const cookie = new Headers(init?.headers).get('cookie') ?? ''
      if (!cookie.includes('sessionid=S')) return new Response('', { status: 401 })
      return new Response('', {
        status: 302,
        headers: { location: 'https://api.beatport.com/v4/auth/o/post-message/?code=C' },
      })
    }
    if (path === '/v4/auth/o/token/') {
      const form = new URLSearchParams(String(init?.body))
      if (invalidClient) {
        invalidClient = false
        return new Response('{"error":"invalid_client"}', { status: 401 })
      }
      if (form.get('grant_type') === 'refresh_token') {
        if (!options.refreshOk) return new Response('{"error":"invalid_grant"}', { status: 400 })
        return Response.json({ access_token: 'A2', refresh_token: 'R2', expires_in: 36000 })
      }
      issued++
      return Response.json({
        access_token: `A${issued === 1 ? 1 : `1.${issued}`}`,
        refresh_token: 'R1',
        expires_in: 36000,
      })
    }
    return new Response('', { status: 404 })
  }) as typeof globalThis.fetch
  const count = (path: string) => calls.filter((c) => c === path).length
  return { fetch, calls, count }
}

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

async function keyOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (err) {
    return errorKeyOf((err as Error).message)
  }
  return 'resolved'
}

describe('Beatport session', () => {
  it('logs in once and reuses the token while it is fresh, so a batch does not hammer the login', async () => {
    const bp = fakeBeatport()
    const c = clock()
    const session = createBeatportSession({
      fetch: bp.fetch,
      credentials: () => ({ username: 'u', password: 'p' }),
      now: c.now,
    })
    expect(await session.getAccessToken()).toBe('A1')
    expect(await session.getAccessToken()).toBe('A1')
    expect(bp.count('/v4/auth/login/')).toBe(1)
  })

  it('ten searches arriving with no token share one login instead of racing ten', async () => {
    const bp = fakeBeatport()
    const session = createBeatportSession({
      fetch: bp.fetch,
      credentials: () => ({ username: 'u', password: 'p' }),
      now: clock().now,
    })
    const tokens = await Promise.all(Array.from({ length: 10 }, () => session.getAccessToken()))
    expect(new Set(tokens)).toEqual(new Set(['A1']))
    expect(bp.count('/v4/auth/login/')).toBe(1)
  })

  it('renews with the refresh token when the access token expires, without the password', async () => {
    const bp = fakeBeatport({ refreshOk: true })
    const c = clock()
    const session = createBeatportSession({
      fetch: bp.fetch,
      credentials: () => ({ username: 'u', password: 'p' }),
      now: c.now,
    })
    await session.getAccessToken()
    c.advance(36_000_000)
    expect(await session.getAccessToken()).toBe('A2')
    expect(bp.count('/v4/auth/login/')).toBe(1)
  })

  it('logs in again when the refresh is refused, so the background sweep never goes silent', async () => {
    const bp = fakeBeatport({ refreshOk: false })
    const c = clock()
    const session = createBeatportSession({
      fetch: bp.fetch,
      credentials: () => ({ username: 'u', password: 'p' }),
      now: c.now,
    })
    await session.getAccessToken()
    c.advance(36_000_000)
    expect(await session.getAccessToken()).toMatch(/^A1/)
    expect(bp.count('/v4/auth/login/')).toBe(2)
  })

  it('invalidate after a 401 forces a new token on the next call', async () => {
    const bp = fakeBeatport({ refreshOk: true })
    const session = createBeatportSession({
      fetch: bp.fetch,
      credentials: () => ({ username: 'u', password: 'p' }),
      now: clock().now,
    })
    const first = await session.getAccessToken()
    session.invalidate()
    expect(await session.getAccessToken()).not.toBe(first)
  })

  it('a password changed on beatport.com surfaces as bad credentials and stops retrying', async () => {
    const bp = fakeBeatport()
    const session = createBeatportSession({
      fetch: bp.fetch,
      credentials: () => ({ username: 'u', password: 'wrong' }),
      now: clock().now,
    })
    expect(await keyOf(session.getAccessToken())).toBe('beatportBadCredentials')
    expect(await keyOf(session.getAccessToken())).toBe('beatportBadCredentials')
    expect(bp.count('/v4/auth/login/')).toBe(1)
    session.reset()
    await keyOf(session.getAccessToken())
    expect(bp.count('/v4/auth/login/')).toBe(2)
  })

  it('without stored credentials it asks the user to connect', async () => {
    const bp = fakeBeatport()
    const session = createBeatportSession({
      fetch: bp.fetch,
      credentials: () => null,
      now: clock().now,
    })
    expect(await keyOf(session.getAccessToken())).toBe('beatportNotConnected')
    expect(bp.calls).toEqual([])
  })

  it('validate checks the account without storing a token', async () => {
    const bp = fakeBeatport()
    const session = createBeatportSession({
      fetch: bp.fetch,
      credentials: () => null,
      now: clock().now,
    })
    expect(await keyOf(session.validate({ username: 'u', password: 'p' }))).toBe('resolved')
    expect(await keyOf(session.validate({ username: 'u', password: 'x' }))).toBe(
      'beatportBadCredentials',
    )
    expect(await keyOf(session.getAccessToken())).toBe('beatportNotConnected')
  })

  it('a rotated client id is looked up again once, so a Beatport redeploy does not break everyone', async () => {
    const bp = fakeBeatport({ invalidClientOnce: true })
    const session = createBeatportSession({
      fetch: bp.fetch,
      credentials: () => ({ username: 'u', password: 'p' }),
      now: clock().now,
    })
    expect(await session.getAccessToken()).toMatch(/^A1/)
    expect(bp.count('/v4/docs/')).toBe(2)
  })

  it('a rejected attempt releases the in-flight slot so the next call retries', async () => {
    const bp = fakeBeatport({ loginThrowsOnce: true })
    const session = createBeatportSession({
      fetch: bp.fetch,
      credentials: () => ({ username: 'u', password: 'p' }),
      now: clock().now,
    })
    expect(await keyOf(session.getAccessToken())).toBe('beatportUnavailable')
    expect(await session.getAccessToken()).toBe('A1')
  })
})
