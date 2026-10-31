import { describe, expect, it, vi } from 'vitest'
import { engineSizeFollower } from './engineSizeFollow'

// A file rewritten on its own path outside a conversion still has Engine DJ's row recording
// its old size: the row gets the same in-place repoint a conversion's flush sends, through the
// queue that waits while Engine is open.
describe('engineSizeFollower', () => {
  it('queues the in-place repoint with the size the row should still hold, and applies it', () => {
    const enqueue = vi.fn()
    const apply = vi.fn()
    engineSizeFollower({ enabled: () => true, enqueue, apply })('/m/c.aiff', 1234)
    expect(enqueue).toHaveBeenCalledWith(
      [],
      [{ from: '/m/c.aiff', to: '/m/c.aiff', fromBytes: 1234 }],
    )
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('leaves Engine DJ alone while its sync is off', () => {
    const enqueue = vi.fn()
    const apply = vi.fn()
    engineSizeFollower({ enabled: () => false, enqueue, apply })('/m/c.aiff', 1234)
    expect(enqueue).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })
})
