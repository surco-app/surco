import { describe, expect, it, vi } from 'vitest'
import { createFileSignatures } from './fileSignatures'

// Measured 01/11 on a 2041-track Music library on a NAS: every cache lookup asked the NAS
// for the file's date first, and those 2041 questions held the list's tags back 11-19 s.
// With the dates seen last time the same lookups took 0.55 s.
function setup(saved: Record<string, number> = {}, onDisk: Record<string, number> = {}) {
  const disk = { ...onDisk }
  const look = async (path: string) => {
    if (!(path in disk)) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    return { mtimeMs: disk[path] }
  }
  const stat = vi.fn(look)
  const deferred: (() => Promise<void>)[] = []
  const onChanged = vi.fn()
  const save = vi.fn()
  const verifyStat = vi.fn(look)
  const signatures = createFileSignatures({
    load: () => saved,
    save,
    stat,
    verifyStat,
    onChanged,
    defer: (run) => deferred.push(run),
  })
  const verify = async () => {
    while (deferred.length > 0) await deferred.shift()?.()
  }
  return { signatures, stat, verifyStat, onChanged, save, disk, verify }
}

describe('fileSignatures', () => {
  it('answers a date seen last time without asking the disk', async () => {
    const { signatures, stat } = setup({ '/nas/a.wav': 100 }, { '/nas/a.wav': 100 })

    expect(await signatures.mtimeOf('/nas/a.wav')).toBe(100)
    expect(stat).not.toHaveBeenCalled()
  })

  it('asks the disk once for a file never seen and remembers the answer', async () => {
    const { signatures, stat, save } = setup({}, { '/nas/a.wav': 100 })

    expect(await signatures.mtimeOf('/nas/a.wav')).toBe(100)
    expect(await signatures.mtimeOf('/nas/a.wav')).toBe(100)

    expect(stat).toHaveBeenCalledOnce()
    signatures.flush()
    expect(save).toHaveBeenLastCalledWith({ '/nas/a.wav': 100 })
  })

  it('checks a remembered date in the background and says nothing when it still holds', async () => {
    const { signatures, onChanged, verify, verifyStat } = setup(
      { '/nas/a.wav': 100 },
      { '/nas/a.wav': 100 },
    )
    await signatures.mtimeOf('/nas/a.wav')

    await verify()

    expect(verifyStat).toHaveBeenCalledOnce()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('reports a file changed outside Surco and serves its new date from then on', async () => {
    const { signatures, onChanged, verify } = setup({ '/nas/a.wav': 100 }, { '/nas/a.wav': 200 })
    await signatures.mtimeOf('/nas/a.wav')

    await verify()

    expect(onChanged).toHaveBeenCalledExactlyOnceWith(['/nas/a.wav'])
    expect(await signatures.mtimeOf('/nas/a.wav')).toBe(200)
  })

  it('reports a file that is gone', async () => {
    const { signatures, onChanged, verify } = setup({ '/nas/a.wav': 100 }, {})
    await signatures.mtimeOf('/nas/a.wav')

    await verify()

    expect(onChanged).toHaveBeenCalledExactlyOnceWith(['/nas/a.wav'])
  })

  it('checks each file once per session, however often it is looked up', async () => {
    const { signatures, verify, verifyStat } = setup({ '/nas/a.wav': 100 }, { '/nas/a.wav': 100 })
    await signatures.mtimeOf('/nas/a.wav')
    await verify()
    await signatures.mtimeOf('/nas/a.wav')

    await verify()

    expect(verifyStat).toHaveBeenCalledOnce()
  })

  it('always asks the disk for a fresh date, and reports the change it finds', async () => {
    const { signatures, onChanged, stat } = setup({ '/nas/a.wav': 100 }, { '/nas/a.wav': 200 })

    expect(await signatures.fresh('/nas/a.wav')).toBe(200)

    expect(stat).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenCalledExactlyOnceWith(['/nas/a.wav'])
    expect(await signatures.mtimeOf('/nas/a.wav')).toBe(200)
  })

  it('keeps a remembered date when the disk cannot be asked for another reason', async () => {
    const { signatures, onChanged, verify, verifyStat } = setup({ '/nas/a.wav': 100 })
    verifyStat.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    await signatures.mtimeOf('/nas/a.wav')

    await verify()

    expect(onChanged).not.toHaveBeenCalled()
    expect(await signatures.mtimeOf('/nas/a.wav')).toBe(100)
  })

  it('checks in the background through its own, gentler way of asking the disk', async () => {
    const { signatures, verify, stat, verifyStat } = setup(
      { '/nas/a.wav': 100 },
      { '/nas/a.wav': 100 },
    )
    await signatures.mtimeOf('/nas/a.wav')

    await verify()

    expect(verifyStat).toHaveBeenCalledWith('/nas/a.wav')
    expect(stat).not.toHaveBeenCalled()
  })

  // Asked right before a write: tags read from a file changed since must not be written back.
  describe('changed', () => {
    it('says a file changed since it was last seen', async () => {
      const { signatures } = setup({ '/nas/a.wav': 100 }, { '/nas/a.wav': 200 })
      expect(await signatures.changed('/nas/a.wav')).toBe(true)
      expect(await signatures.mtimeOf('/nas/a.wav')).toBe(200)
    })

    it('says a file that is gone changed', async () => {
      const { signatures } = setup({ '/nas/a.wav': 100 }, {})
      expect(await signatures.changed('/nas/a.wav')).toBe(true)
    })

    it('says an unchanged file did not', async () => {
      const { signatures } = setup({ '/nas/a.wav': 100 }, { '/nas/a.wav': 100 })
      expect(await signatures.changed('/nas/a.wav')).toBe(false)
    })
  })
})
