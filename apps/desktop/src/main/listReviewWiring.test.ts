import { describe, expect, it, vi } from 'vitest'

vi.mock('./applemusic', () => ({}))
vi.mock('./libraryFlushes', () => ({}))
const rewriteTagFields = vi.fn()
vi.mock('./musicFieldWrite', () => ({
  rewriteTagFields: (...args: unknown[]) => rewriteTagFields(...args),
}))

import { listReviewDeps } from './listReviewWiring'

// A fix the list review writes over the file reaches Engine DJ's row, which records its size.
describe('listReviewDeps', () => {
  it('hands the file write what tells Engine DJ the file was rewritten', async () => {
    const followEngineSize = vi.fn()
    const tmp = { track: vi.fn(), untrack: vi.fn() }
    const deps = listReviewDeps({
      mediaAccess: {} as never,
      tmp,
      hostFor: vi.fn(),
      sessions: {} as never,
      followEngineSize,
    })
    const changes = [{ field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara' }]
    await deps.apply.rewrite('/m/c.aiff', changes)
    expect(rewriteTagFields).toHaveBeenCalledWith('/m/c.aiff', changes, tmp, followEngineSize)
  })
})
