import { describe, expect, it, vi } from 'vitest'
import { sharedPrompt } from './sharedPrompt'

function deferred() {
  let resolve: (v: boolean) => void = () => {}
  const promise = new Promise<boolean>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('sharedPrompt', () => {
  // One flush repoints many tracks: they must share one "rekordbox is open" dialog.
  it('asks once for callers asking the same question at the same time', async () => {
    const answer = deferred()
    const ask = vi.fn(() => answer.promise)
    const prompt = sharedPrompt(ask)
    const both = Promise.all([prompt('conversion'), prompt('conversion')])
    answer.resolve(true)
    expect(await both).toEqual([true, true])
    expect(ask).toHaveBeenCalledTimes(1)
  })

  // A playlist edit arriving while the conversion's dialog is up got the conversion's
  // answer to a question it never showed. It waits, then asks its own.
  it('asks a different question once the pending one is answered, never inside it', async () => {
    const first = deferred()
    const ask = vi.fn((key: string) =>
      key === 'conversion' ? first.promise : Promise.resolve(false),
    )
    const prompt = sharedPrompt(ask)
    const conversion = prompt('conversion')
    const playlist = prompt('playlist')
    await Promise.resolve()
    expect(ask).toHaveBeenCalledTimes(1)
    first.resolve(true)
    expect(await conversion).toBe(true)
    expect(await playlist).toBe(false)
    expect(ask).toHaveBeenLastCalledWith('playlist')
  })
})
