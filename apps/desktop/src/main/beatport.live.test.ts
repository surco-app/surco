import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'

const { liveCacheDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return { liveCacheDir: mkdtempSync(join(tmpdir(), 'surco-beatport-live-')) }
})
vi.mock('electron', () => ({ app: { getPath: () => liveCacheDir, on: () => {} } }))

import { getRelease, search, setBeatportSession } from './beatport'
import { createBeatportSession } from './beatportSession'

const live = process.env.SURCO_BEATPORT_LIVE === '1'

function keychainCredentials() {
  const attrs = execFileSync('security', [
    'find-generic-password',
    '-s',
    'surco-beatport',
  ]).toString()
  const username = attrs.match(/"acct"<blob>="([^"]*)"/)?.[1] ?? ''
  const password = execFileSync('security', ['find-generic-password', '-s', 'surco-beatport', '-w'])
    .toString()
    .trim()
  return { username, password }
}

describe.skipIf(!live)('Beatport against the real API', () => {
  it('finds DESPECHÁ and loads its four versions with bpm and key', async () => {
    const credentials = keychainCredentials()
    setBeatportSession(
      createBeatportSession({
        fetch: (...a) => fetch(...a),
        credentials: () => credentials,
        now: Date.now,
      }),
    )
    const rows = await search('ROSALÍA DESPECHÁ', 'high', { artist: 'ROSALÍA', title: 'DESPECHÁ' })
    const hit = rows.find((r) => r.id === 6386332)
    expect(hit).toBeDefined()
    const release = await getRelease(6386332)
    expect(release.tracklist).toHaveLength(4)
    expect(release.tracklist.every((t) => t.bpm === '130' && t.key === 'G Major')).toBe(true)
    expect(release.labels?.[0].name).toBe('Columbia')
  }, 30_000)
})
