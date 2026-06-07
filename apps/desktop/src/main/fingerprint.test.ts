import { describe, expect, it, vi } from 'vitest'

// fingerprint.ts imports binaries.ts, which reads electron's `app`; stub it so the
// pure helpers can be imported in the node test environment.
vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { acoustidUrl, fpcalcArgs, parseAcoustidResponse, parseFpcalc } from './fingerprint'

describe('parseFpcalc', () => {
  it('reads the fingerprint and duration out of fpcalc -json output', () => {
    const out = JSON.stringify({ duration: 234.56, fingerprint: 'AQABz0m...' })
    expect(parseFpcalc(out)).toEqual({ fingerprint: 'AQABz0m...', duration: 234.56 })
  })

  it('throws when fpcalc produced no usable fingerprint', () => {
    // A decode failure prints an empty/garbage object; better to fail loudly than
    // send an empty fingerprint AcoustID would reject anyway.
    expect(() => parseFpcalc('{}')).toThrow()
    expect(() => parseFpcalc('not json')).toThrow()
  })
})

describe('fpcalcArgs', () => {
  it('asks fpcalc for JSON over a capped analysis window', () => {
    // 120s is plenty to fingerprint a track and keeps long DJ mixes from being slow.
    expect(fpcalcArgs('/music/a.wav')).toEqual(['-json', '-length', '120', '/music/a.wav'])
  })
})

describe('acoustidUrl', () => {
  it('builds a lookup URL with the client key, integer duration and fingerprint', () => {
    const url = new URL(acoustidUrl('AQABz0m', 234.56, 'CLIENTKEY'))
    expect(url.origin + url.pathname).toBe('https://api.acoustid.org/v2/lookup')
    expect(url.searchParams.get('client')).toBe('CLIENTKEY')
    // AcoustID matches on an integer-second duration.
    expect(url.searchParams.get('duration')).toBe('235')
    expect(url.searchParams.get('fingerprint')).toBe('AQABz0m')
    expect(url.searchParams.get('meta')).toContain('recordings')
  })
})

describe('parseAcoustidResponse', () => {
  const response = {
    status: 'ok',
    results: [
      { id: 'low', score: 0.4, recordings: [{ title: 'Wrong', artists: [{ name: 'Nope' }] }] },
      {
        id: 'best',
        score: 0.93,
        recordings: [
          {
            title: 'Run To Me',
            artists: [{ name: 'Ruffcut' }, { name: 'Carol Jones' }],
            releasegroups: [{ title: '21st Century Collection' }],
          },
        ],
      },
    ],
  }

  it('returns the highest-scoring recording mapped to metadata', () => {
    expect(parseAcoustidResponse(response)).toEqual({
      title: 'Run To Me',
      artist: 'Ruffcut, Carol Jones',
      album: '21st Century Collection',
      score: 0.93,
    })
  })

  it('returns null when AcoustID reports an error status', () => {
    expect(parseAcoustidResponse({ status: 'error', error: { message: 'invalid' } })).toBeNull()
  })

  it('returns null when nothing matched', () => {
    expect(parseAcoustidResponse({ status: 'ok', results: [] })).toBeNull()
  })

  it('skips results that carry a score but no recording', () => {
    const data = {
      status: 'ok',
      results: [
        { id: 'bare', score: 0.99 },
        { id: 'has', score: 0.7, recordings: [{ title: 'Only Match', artists: [{ name: 'X' }] }] },
      ],
    }
    expect(parseAcoustidResponse(data)?.title).toBe('Only Match')
  })
})
