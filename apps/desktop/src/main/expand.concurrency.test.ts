import { describe, expect, it, vi } from 'vitest'

// Two sibling subfolders. Each readdir announces it has started and then parks on a
// barrier that only releases once BOTH have started — so this resolves only when the two
// subtrees are walked concurrently. A serial walk (one subtree fully finished before the
// next begins) would reach the barrier with a count of 1, never release it, and time out.
// This is what keeps a deep or network folder from adding up its per-directory latency.
let started = 0
let release: () => void
const barrier = new Promise<void>((r) => {
  release = r
})

vi.mock('node:fs/promises', () => ({
  stat: async (p: string) => ({ isDirectory: () => p === '/root' }),
  readdir: async (dir: string) => {
    if (dir === '/root') {
      return [
        { name: 'a', isDirectory: () => true },
        { name: 'b', isDirectory: () => true },
      ]
    }
    started += 1
    if (started === 2) release()
    await barrier
    return [{ name: `${dir.endsWith('a') ? 'a' : 'b'}.wav`, isDirectory: () => false }]
  },
}))

import { expandPaths } from './expand'

describe('expandPaths walks subfolders concurrently', () => {
  it('does not finish one subtree before starting the next', async () => {
    const result = await expandPaths(['/root'])
    expect(result.sort()).toEqual(['/root/a/a.wav', '/root/b/b.wav'])
  }, 1000)
})
