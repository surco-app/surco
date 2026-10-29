import { describe, expect, it, vi } from 'vitest'
import { createSessionBackup } from './rekordboxSessionBackup'

describe('createSessionBackup', () => {
  it('one copy per momento, however many tracks it writes', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({ take })
    backup.begin('run')

    await backup.ensure('/dj/master.db')
    await backup.ensure('/dj/master.db')
    await backup.ensure('/dj/master.db')

    expect(take).toHaveBeenCalledTimes(1)
    expect(take).toHaveBeenCalledWith('/dj/master.db', [], 'run')
  })

  it('a new momento takes a new copy', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({ take })

    backup.begin('run')
    await backup.ensure('/dj/master.db')
    backup.begin('cues')
    await backup.ensure('/dj/master.db')

    expect(take).toHaveBeenCalledTimes(2)
    expect(take).toHaveBeenLastCalledWith('/dj/master.db', [], 'cues')
  })

  it('small playlist edits share one copy per Surco session', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({ take })

    backup.beginLoose('/dj/master.db')
    await backup.ensure('/dj/master.db')
    backup.beginLoose('/dj/master.db')
    await backup.ensure('/dj/master.db')

    expect(take).toHaveBeenCalledTimes(1)
    expect(take).toHaveBeenCalledWith('/dj/master.db', [], 'playlists')
  })

  it('a playlist edit on one collection does not relabel another collection copy', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({ take })
    backup.begin('run')

    backup.beginLoose('/dj/one.db')
    await backup.ensure('/dj/two.db')

    expect(take).toHaveBeenCalledWith('/dj/two.db', [], 'run')
  })

  it('the rekordbox XML is copied with master.db, not on its own', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({
      take,
      companionsOf: (p) => (p === '/dj/master.db' ? ['/dj/masterPlaylists6.xml'] : []),
      skip: (p) => p === '/dj/masterPlaylists6.xml',
    })
    backup.begin('run')

    await backup.ensure('/dj/master.db')
    await backup.ensure('/dj/masterPlaylists6.xml')

    expect(take).toHaveBeenCalledTimes(1)
    expect(take).toHaveBeenCalledWith('/dj/master.db', ['/dj/masterPlaylists6.xml'], 'run')
  })

  it('a failed copy is remembered so the Copias screen can say so', async () => {
    const take = vi
      .fn<() => Promise<never>>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce({} as never)
    const backup = createSessionBackup({ take })
    backup.begin('run')

    await expect(backup.ensure('/dj/master.db')).rejects.toThrow('disk full')
    expect([...backup.failed()]).toEqual(['/dj/master.db'])

    await backup.ensure('/dj/master.db')
    expect(backup.failed().size).toBe(0)
    expect(take).toHaveBeenCalledTimes(2)
  })

  it('keeps a separate copy per collection', async () => {
    const take = vi.fn(async () => ({}) as never)
    const backup = createSessionBackup({ take })
    backup.begin('run')

    await backup.ensure('/dj/one.db')
    await backup.ensure('/dj/two.db')

    expect(take).toHaveBeenCalledTimes(2)
  })
})
