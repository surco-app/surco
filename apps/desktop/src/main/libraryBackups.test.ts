import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { backupOf, setLibraryBackupRoot } from './libraryBackups'

describe('backupOf', () => {
  // On a user's Windows machine Surco could read collection.nml but not create files next
  // to it, so every cue save and playlist ended in "No se pudo hacer la copia de Traktor".
  // Surco's own folder is the one place it can always write.
  it('puts the copy in Surco folder, never next to the collection', () => {
    setLibraryBackupRoot('/surco/backups')
    const copy = backupOf('/dj/Traktor 4/collection.nml', 'backup')
    expect(copy.startsWith(join('/surco/backups'))).toBe(true)
    expect(copy.endsWith('collection.nml.surco-backup')).toBe(true)
    expect(copy.includes('Traktor 4')).toBe(true)
  })

  // Traktor 3 and Traktor 4 both keep a collection.nml: sharing one copy would let a
  // restore put one collection over the other.
  it('keeps apart two collections with the same name', () => {
    setLibraryBackupRoot('/surco/backups')
    expect(backupOf('/dj/Traktor 3/collection.nml', 'backup')).not.toBe(
      backupOf('/dj/Traktor 4/collection.nml', 'backup'),
    )
  })

  it('finds the same copy again for the same collection, which is what a restore reads', () => {
    setLibraryBackupRoot('/surco/backups')
    expect(backupOf('/dj/rekordbox/master.db', 'backup')).toBe(
      backupOf('/dj/rekordbox/master.db', 'backup'),
    )
  })

  it('keeps the run copy apart from the per-write copy', () => {
    setLibraryBackupRoot('/surco/backups')
    expect(backupOf('/dj/rekordbox/master.db', 'session')).toMatch(/master\.db\.surco-session$/)
  })

  it('refuses to name a copy before Surco says where its folder is', async () => {
    vi.resetModules()
    const fresh = await import('./libraryBackups')
    expect(() => fresh.backupOf('/dj/rekordbox/master.db', 'backup')).toThrow()
  })
})
