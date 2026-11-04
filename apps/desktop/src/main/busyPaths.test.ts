import { describe, expect, it } from 'vitest'
import { createBusyPaths } from './busyPaths'

describe('createBusyPaths', () => {
  it('holds a file from mark to clear, in any Unicode form and, where the disk folds it, any case', () => {
    const busy = createBusyPaths(true)
    busy.mark('/Volumes/M/Cafe\u0301.mp3')
    expect(busy.has('/volumes/m/CAFÉ.mp3')).toBe(true)
    expect(busy.has('/Volumes/M/other.mp3')).toBe(false)
    busy.clear('/Volumes/M/Café.mp3')
    expect(busy.has('/Volumes/M/Café.mp3')).toBe(false)
  })

  it('keeps the case apart where the disk does', () => {
    const busy = createBusyPaths(false)
    busy.mark('/m/A.mp3')
    expect(busy.has('/m/a.mp3')).toBe(false)
  })

  it('stays held while a second mark on the same file is not cleared', () => {
    const busy = createBusyPaths(true)
    busy.mark('/m/a.mp3')
    busy.mark('/m/a.mp3')
    busy.clear('/m/a.mp3')
    expect(busy.has('/m/a.mp3')).toBe(true)
  })

  it('lets a waiter on with the file free and holds it until the file is cleared', async () => {
    const busy = createBusyPaths(true)
    await busy.idle('/m/a.mp3')
    busy.mark('/m/a.mp3')
    let freed = false
    const waiting = busy.idle('/m/A.mp3').then(() => {
      freed = true
    })
    await Promise.resolve()
    expect(freed).toBe(false)
    busy.clear('/m/a.mp3')
    await waiting
    expect(freed).toBe(true)
  })
})
