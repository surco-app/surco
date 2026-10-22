import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    stdout: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.pid = 4242
  child.stdout = new EventEmitter()
  child.kill = vi.fn()
  return child
}

const spawned: ReturnType<typeof fakeChild>[] = []

vi.mock('node:child_process', () => ({
  spawn: () => {
    const child = fakeChild()
    spawned.push(child)
    return child
  },
}))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  setPriority: vi.fn(),
}))

import { killCueWaveWords, runCueWaveWords } from './cueWaveWords'

beforeEach(() => {
  spawned.length = 0
})

describe('killCueWaveWords', () => {
  it('stops every decode still running, so quitting mid-batch leaves no ffmpeg reading a long track', () => {
    for (const input of ['/a.aiff', '/b.aiff'])
      runCueWaveWords(input, '/bin/ffmpeg', 44100, 120_000).catch(() => {})
    killCueWaveWords()
    for (const child of spawned) expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('leaves alone a decode that already finished, whose pid the system may have handed on', async () => {
    const done = runCueWaveWords('/a.aiff', '/bin/ffmpeg', 44100, 120_000)
    spawned[0].emit('close', 0)
    await done
    killCueWaveWords()
    expect(spawned[0].kill).not.toHaveBeenCalled()
  })
})
