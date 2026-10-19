// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { resetRowWaves, rowWaveOf, subscribeRowWave } from './rowWaves'

afterEach(() => {
  resetRowWaves()
  vi.useRealTimers()
})

function stub(answer: Api['rowWaves']): ReturnType<typeof vi.fn<Api['rowWaves']>> {
  const rowWaves = vi.fn<Api['rowWaves']>(answer)
  ;(window as unknown as { api: Partial<Api> }).api = { rowWaves }
  return rowWaves
}

describe('row waves', () => {
  it('asks once for every row that mounts in the same frame', async () => {
    vi.useFakeTimers()
    const rowWaves = stub(async () => ({ '/a.DAT': [1], '/m/b.wav': [0.5] }))
    const seen = vi.fn()
    subscribeRowWave({ path: '/m/a.wav', analysisPath: '/a.DAT' }, seen)
    subscribeRowWave({ path: '/m/b.wav' }, seen)
    await vi.advanceTimersByTimeAsync(20)
    expect(rowWaves).toHaveBeenCalledTimes(1)
    expect(rowWaves.mock.calls[0][0]).toHaveLength(2)
    expect(rowWaveOf('/a.DAT')).toEqual([1])
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('remembers a wave, so scrolling back never asks again', async () => {
    vi.useFakeTimers()
    const rowWaves = stub(async () => ({ '/m/b.wav': [0.5] }))
    subscribeRowWave({ path: '/m/b.wav' }, () => {})()
    await vi.advanceTimersByTimeAsync(20)
    subscribeRowWave({ path: '/m/b.wav' }, () => {})
    await vi.advanceTimersByTimeAsync(20)
    expect(rowWaves).toHaveBeenCalledTimes(1)
  })

  it('settles a failed ask as no wave instead of throwing', async () => {
    vi.useFakeTimers()
    stub(async () => {
      throw new Error('ipc down')
    })
    subscribeRowWave({ path: '/m/c.wav' }, () => {})
    await vi.advanceTimersByTimeAsync(20)
    expect(rowWaveOf('/m/c.wav')).toBeNull()
  })
})
