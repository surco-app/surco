import { errorKeyOf, errorWithKey } from '../shared/errorKeys'
import { REQUEST_TIMEOUT_MS, USER_AGENT } from './http'

export const BEATPORT_API = 'https://api.beatport.com/v4'
const REDIRECT_URI = `${BEATPORT_API}/auth/o/post-message/`
const EXPIRY_MARGIN_MS = 60_000

export interface BeatportCredentials {
  username: string
  password: string
}

export interface BeatportSessionDeps {
  fetch: typeof fetch
  credentials: () => BeatportCredentials | null
  now: () => number
}

export interface BeatportSession {
  getAccessToken(): Promise<string>
  invalidate(staleAccess: string): void
  validate(credentials: BeatportCredentials): Promise<void>
  reset(): void
}

interface Token {
  access: string
  refresh?: string
  expiresAt: number
}

interface TokenBody {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

export function createBeatportSession(deps: BeatportSessionDeps): BeatportSession {
  let clientId: string | undefined
  let token: Token | undefined
  let inflight: Promise<string> | undefined
  let rejected = false

  const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('User-Agent', USER_AGENT)
    try {
      return await deps.fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      throw errorWithKey('beatportUnavailable', String(err))
    }
  }

  const discoverClientId = async (): Promise<string> => {
    if (clientId) return clientId
    const html = await (await request(`${BEATPORT_API}/docs/`)).text()
    for (const src of html.match(/\/static\/btprt\/[^"']+\.js/g) ?? []) {
      const js = await (await request(`https://api.beatport.com${src}`)).text()
      const found = js.match(/API_CLIENT_ID:\s*['"]([^'"]+)['"]/)?.[1]
      if (found) {
        clientId = found
        return found
      }
    }
    throw errorWithKey('beatportUnavailable', 'client id')
  }

  const tokenFrom = (body: TokenBody): Token => {
    if (!body.access_token) throw errorWithKey('beatportUnavailable', 'token')
    return {
      access: body.access_token,
      refresh: body.refresh_token,
      expiresAt: deps.now() + (body.expires_in ?? 0) * 1000,
    }
  }

  const exchange = (params: Record<string, string>): Promise<Response> =>
    request(`${BEATPORT_API}/auth/o/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    })

  const authorize = async (cookie: string): Promise<Response> => {
    const id = await discoverClientId()
    const auth = await request(
      `${BEATPORT_API}/auth/o/authorize/?response_type=code&client_id=${id}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
      { headers: { Cookie: cookie }, redirect: 'manual' },
    )
    const code = new URL(auth.headers.get('location') ?? '', BEATPORT_API).searchParams.get('code')
    if (!code) throw errorWithKey('beatportUnavailable', `authorize ${auth.status}`)
    return exchange({
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      client_id: id,
    })
  }

  const login = async ({ username, password }: BeatportCredentials): Promise<Token> => {
    await discoverClientId()
    const res = await request(`${BEATPORT_API}/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (res.status === 401 || res.status === 403) throw errorWithKey('beatportBadCredentials')
    if (!res.ok) throw errorWithKey('beatportUnavailable', `login ${res.status}`)
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    let granted = await authorize(cookie)
    if (granted.status === 401) {
      clientId = undefined
      granted = await authorize(cookie)
    }
    if (!granted.ok) throw errorWithKey('beatportUnavailable', `token ${granted.status}`)
    return tokenFrom((await granted.json()) as TokenBody)
  }

  const renew = async (refresh: string): Promise<Token | undefined> => {
    const res = await exchange({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: await discoverClientId(),
    })
    return res.ok ? tokenFrom((await res.json()) as TokenBody) : undefined
  }

  const fresh = async (): Promise<string> => {
    if (rejected) throw errorWithKey('beatportBadCredentials')
    if (token && token.expiresAt - EXPIRY_MARGIN_MS > deps.now()) return token.access
    if (token?.refresh) {
      const renewed = await renew(token.refresh)
      if (renewed) {
        token = renewed
        return renewed.access
      }
    }
    const credentials = deps.credentials()
    if (!credentials) throw errorWithKey('beatportNotConnected')
    try {
      token = await login(credentials)
      return token.access
    } catch (err) {
      if (errorKeyOf((err as Error).message) === 'beatportBadCredentials') {
        rejected = true
        token = undefined
      }
      throw err
    }
  }

  return {
    getAccessToken() {
      inflight ??= fresh().finally(() => {
        inflight = undefined
      })
      return inflight
    },
    invalidate(staleAccess) {
      if (token?.access === staleAccess) token = { ...token, expiresAt: 0 }
    },
    async validate(credentials) {
      await login(credentials)
    },
    reset() {
      token = undefined
      rejected = false
    },
  }
}
