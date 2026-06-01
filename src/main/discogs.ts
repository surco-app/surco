import { writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { DiscogsSearchResult, DiscogsRelease } from '../shared/types'

const BASE = 'https://api.discogs.com'
const USER_AGENT = 'Vinilo/0.1 +https://github.com/vigosan/vinilo'

async function api<T>(path: string, token: string): Promise<T> {
  if (!token) throw new Error('Falta el token de Discogs. Configúralo en Ajustes.')
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (res.status === 401) throw new Error('Token de Discogs inválido.')
  if (res.status === 429) throw new Error('Límite de peticiones de Discogs alcanzado. Espera un momento.')
  if (!res.ok) throw new Error(`Discogs devolvió ${res.status}`)
  return res.json() as Promise<T>
}

export async function search(query: string, token: string): Promise<DiscogsSearchResult[]> {
  const data = await api<{ results: DiscogsSearchResult[] }>(
    `/database/search?type=release&q=${encodeURIComponent(query)}&per_page=20`,
    token
  )
  return data.results ?? []
}

export async function getRelease(id: number, token: string): Promise<DiscogsRelease> {
  return api<DiscogsRelease>(`/releases/${id}`, token)
}

export async function downloadCover(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`No se pudo descargar la carátula (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = res.headers.get('content-type')?.includes('png') ? 'png' : 'jpg'
  const path = join(tmpdir(), `vinilo-cover-${Date.now()}.${ext}`)
  await writeFile(path, buf)
  return path
}
