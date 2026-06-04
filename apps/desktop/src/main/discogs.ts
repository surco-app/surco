import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiscogsRelease, DiscogsSearchResult } from '../shared/types'
import { tmpName } from './tmp'

const BASE = 'https://api.discogs.com'
const USER_AGENT = 'Surco/0.1 +https://github.com/vigosan/vinilo'

// Surco's own Discogs app credentials. They let search work out of the box
// without each user creating a token, at the cost of a 60 req/min limit shared
// across all users. A user token (when set) takes precedence and gets its own
// bucket. These ship in the binary and are extractable — treat them as public.
const APP_KEY = 'mWMICwBUWiUpKwjXUOnG'
const APP_SECRET = 'otWEkXSaNXZehSTINgxSeTiPKsGbvNxJ'

function authParams(token: string): string {
  return token ? `token=${encodeURIComponent(token)}` : `key=${APP_KEY}&secret=${APP_SECRET}`
}

async function api<T>(path: string, token: string): Promise<T> {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}${authParams(token)}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (res.status === 401) throw new Error('Token de Discogs inválido.')
  if (res.status === 429)
    throw new Error('Límite de peticiones de Discogs alcanzado. Espera un momento.')
  if (!res.ok) throw new Error(`Discogs devolvió ${res.status}`)
  return res.json() as Promise<T>
}

const searchCache = new Map<string, DiscogsSearchResult[]>()

export async function search(query: string, token: string): Promise<DiscogsSearchResult[]> {
  const key = query.trim().toLowerCase()
  const cached = searchCache.get(key)
  if (cached) return cached
  const data = await api<{ results: DiscogsSearchResult[] }>(
    `/database/search?type=release&q=${encodeURIComponent(query)}&per_page=20`,
    token,
  )
  const results = data.results ?? []
  searchCache.set(key, results)
  return results
}

const releaseCache = new Map<number, DiscogsRelease>()

export async function getRelease(id: number, token: string): Promise<DiscogsRelease> {
  const cached = releaseCache.get(id)
  if (cached) return cached
  const release = await api<DiscogsRelease>(`/releases/${id}`, token)
  releaseCache.set(id, release)
  return release
}

export async function downloadCover(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`No se pudo descargar la carátula (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = res.headers.get('content-type')?.includes('png') ? 'png' : 'jpg'
  const path = join(tmpdir(), tmpName('cover', ext))
  await writeFile(path, buf)
  return path
}
