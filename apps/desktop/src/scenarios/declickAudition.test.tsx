// @vitest-environment jsdom
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import ffmpegStatic from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import type { Api } from '../preload/api'
import { type AppScenario, openApp, openSection } from './app'
import { makeTrack, scenarioDir, vinylSource } from './fixtures'

function samples(path: string): Int16Array {
  const pcm = execFileSync(
    ffmpegStatic as unknown as string,
    ['-v', 'error', '-i', path, '-f', 's16le', '-ac', '2', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  return new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2)
}

// How far apart two renders sound, as the level of what is left when one is subtracted
// from the other, in dB below full scale.
function differenceDb(a: string, b: string): number {
  const x = samples(a)
  const y = samples(b)
  const n = Math.min(x.length, y.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += ((x[i] - y[i]) / 32768) ** 2
  return 10 * Math.log10(sum / n + 1e-20)
}

// Watches the renders the A/B plays, without changing them.
function recordAuditions(): string[] {
  const rendered: string[] = []
  const api = window.api
  ;(window as unknown as { api: Api }).api = new Proxy(api, {
    get(target, key) {
      if (key !== 'declickPreview') return target[key as keyof Api]
      return async (...args: Parameters<Api['declickPreview']>) => {
        const out = await target.declickPreview(...args)
        if (out) rendered.push(out.path)
        return out
      }
    },
  })
  return rendered
}

// A digitised record is judged by ear: the DJ picks a repair strength, plays the A/B
// against the original, and converts once it sounds right. The audition is rendered by
// its own ffmpeg call in main, apart from the conversion, so the two can drift (a filter
// added to one chain and not the other) and the file would no longer be what was heard.
describe('Pick a click repair by ear and get exactly that in the file', () => {
  let surco: AppScenario
  let rip: string
  let out: string
  let auditions: string[]

  beforeAll(async () => {
    const folder = scenarioDir('declick-audition')
    rip = join(folder, 'Side A.wav')
    out = join(folder, 'Side A.aiff')
    makeTrack(rip, { title: 'Side A', artist: 'Jaydee', lavfi: vinylSource(20) })
    surco = await openApp({ settings: {}, destination: 'beside' })
    auditions = recordAuditions()
    await surco.drop(folder)
    await surco.select('Side A')
    await openSection('editor-declick')
  }, 90_000)

  afterAll(() => {
    surco.close()
  })

  it('renders the repair to listen to before converting', async () => {
    fireEvent.click(await screen.findByTestId('declick-mode-standard'))
    fireEvent.click(await screen.findByTestId('declick-render', undefined, { timeout: 30_000 }))
    await screen.findByTestId('declick-ab', undefined, { timeout: 60_000 })
    expect(auditions).toHaveLength(1)
  }, 90_000)

  it('writes the file the A/B played', async () => {
    fireEvent.click(screen.getByTestId('process-btn'))
    await waitFor(() => expect(existsSync(out)).toBe(true), { timeout: 60_000 })
    await waitFor(() => expect(screen.queryByTestId('done-more')).not.toBeNull(), {
      timeout: 60_000,
    })
    expect(surco.errors).toEqual([])
    expect(differenceDb(rip, out)).toBeGreaterThan(-60)
    expect(differenceDb(auditions[0], out)).toBeLessThan(-90)
  }, 90_000)
})
