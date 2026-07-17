import { describe, expect, it, vi } from 'vitest'
import { createStickyConflict } from './stickyConflict'

describe('createStickyConflict', () => {
  // A file-name conflict prompts per collision. Without a remembered choice, a batch of
  // similarly-named rips is a wall of identical prompts — so ticking "apply to the rest"
  // must answer every later conflict in the same run without asking again.
  it('reuses a remembered decision for every later conflict in the run', async () => {
    const sticky = createStickyConflict()
    const ask = vi.fn(async () => ({ decision: 'keepBoth' as const, remember: true }))

    expect(await sticky.resolve(ask)).toBe('keepBoth')
    // The second conflict never reaches the prompt — the run already answered.
    expect(await sticky.resolve(ask)).toBe('keepBoth')
    expect(ask).toHaveBeenCalledOnce()
  })

  // Not ticking the box keeps the choice a one-off: the next conflict asks again, so a
  // single "keep both" doesn't silently commit the user to it for the whole run.
  it('asks again when the user did not opt to apply it to the rest', async () => {
    const sticky = createStickyConflict()
    const ask = vi.fn(async () => ({ decision: 'overwrite' as const, remember: false }))

    await sticky.resolve(ask)
    await sticky.resolve(ask)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  // reset runs at the top of each batch: a remembered choice must not leak into the next
  // run, or the second batch would silently overwrite on a decision made in the first.
  it('forgets the remembered decision after a reset', async () => {
    const sticky = createStickyConflict()
    const ask = vi.fn(async () => ({ decision: 'skip' as const, remember: true }))

    await sticky.resolve(ask)
    sticky.reset()
    await sticky.resolve(ask)
    expect(ask).toHaveBeenCalledTimes(2)
  })
})
