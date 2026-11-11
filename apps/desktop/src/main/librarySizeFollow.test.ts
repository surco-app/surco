import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { followingAll, librarySizeFollower } from './librarySizeFollow'

// A file rewritten on its own path outside a conversion still has Engine DJ's row recording
// its old size: the row gets the same in-place repoint a conversion's flush sends, through the
// queue that waits while Engine is open.
describe('librarySizeFollower', () => {
  it('queues the in-place repoint with the size the row should still hold, and applies it', () => {
    const enqueue = vi.fn()
    const apply = vi.fn()
    librarySizeFollower({ enabled: () => true, enqueue, apply })('/m/c.aiff', 1234)
    expect(enqueue).toHaveBeenCalledWith(
      [],
      [{ from: '/m/c.aiff', to: '/m/c.aiff', fromBytes: 1234 }],
    )
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('leaves Engine DJ alone while its sync is off', () => {
    const enqueue = vi.fn()
    const apply = vi.fn()
    librarySizeFollower({ enabled: () => false, enqueue, apply })('/m/c.aiff', 1234)
    expect(enqueue).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })
})

// Every rewrite on a file's own path reaches each library that keeps its size, through one
// follower handed to every place Engine DJ's was.
describe('followingAll', () => {
  it('hands the same rewrite to each library follower, the way back included', () => {
    const engine = vi.fn()
    const virtualdj = vi.fn()
    const shift = { trimmedMs: -1900 }
    followingAll(engine, virtualdj)('/m/c.aiff', 1234, shift)
    followingAll(engine, virtualdj)('/m/d.aiff', 99)
    expect(engine.mock.calls).toEqual([
      ['/m/c.aiff', 1234, shift],
      ['/m/d.aiff', 99],
    ])
    expect(virtualdj.mock.calls).toEqual(engine.mock.calls)
  })

  it('builds the follower handed around from Engine DJ and VirtualDJ, each on its own queue and sync', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf-8')
    expect(source).toMatch(
      /const followLibrarySize = followingAll\(followEngineSize, followVirtualdjSize\)/,
    )
    expect(source).toMatch(
      /const followVirtualdjSize = librarySizeFollower\(\{\s+enabled: \(\) => getSettings\(\)\.syncVirtualdj,\s+enqueue: virtualdjCueQueue\.enqueue,/,
    )
  })

  it.each([
    ['the Serato batch', /applySeratoBatch\(ops, \{[\s\S]*?rewritten: followLibrarySize,/],
    ['the Music review', /registerAppleMusicIpc\(\{[^}]*followLibrarySize,/],
    ['the list review', /listReviewDeps\(\{[^}]*followLibrarySize,/],
    ['a conversion', /runProcessTrack\(job, \{[\s\S]*?followLibrarySize,/],
    [
      'an original restored over its replacement',
      /registerTrashIpc\(surcoTrash, mediaAccess, \{ followEngineSize, followVirtualdjSize \}\)/,
    ],
    ['a damage repair', /damageDeps\(\{[\s\S]*?followEngineSize,\s+followVirtualdjSize,/],
  ])('hands VirtualDJ the rewrites of %s', (_place, wiring) => {
    expect(readFileSync(join(__dirname, 'index.ts'), 'utf-8')).toMatch(wiring)
  })
})
