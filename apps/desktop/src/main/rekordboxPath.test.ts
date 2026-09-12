import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findRekordboxCollection } from './rekordboxPath'

// Unlike Traktor, whose collection folder moves with the version and the user's own
// preference, rekordbox keeps master.db in one place per platform. That is why this can
// detect instead of asking, and why the setting exists only as an override.

describe('findRekordboxCollection', () => {
  it('finds the collection in the standard location', async () => {
    const home = await mkdtemp(join(tmpdir(), 'surco-home-'))
    const dir = join(home, 'Library', 'Pioneer', 'rekordbox')
    await mkdtemp(join(tmpdir(), 'unused-'))
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'master.db'), 'x')

    expect(findRekordboxCollection({ home, platform: 'darwin' })).toBe(join(dir, 'master.db'))
  })

  // A user who does not run rekordbox is the normal case, and the feature simply stays
  // off for them rather than reporting anything.
  it('returns empty when there is no collection there', async () => {
    const home = await mkdtemp(join(tmpdir(), 'surco-home-'))
    expect(findRekordboxCollection({ home, platform: 'darwin' })).toBe('')
  })

  it('looks under the app data folder on Windows', async () => {
    const home = await mkdtemp(join(tmpdir(), 'surco-home-'))
    const dir = join(home, 'AppData', 'Roaming', 'Pioneer', 'rekordbox')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'master.db'), 'x')

    expect(findRekordboxCollection({ home, platform: 'win32' })).toBe(join(dir, 'master.db'))
  })

  // The configured override wins whenever it is set, so a user whose collection lives
  // somewhere else is never silently pointed at a different one.
  it('prefers the configured path over the detected one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'surco-home-'))
    const dir = join(home, 'Library', 'Pioneer', 'rekordbox')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'master.db'), 'x')

    expect(
      findRekordboxCollection({ home, platform: 'darwin', configured: '/elsewhere/my.db' }),
    ).toBe('/elsewhere/my.db')
  })

  // Detection must not resurrect a feature the user turned off: an override pointing at
  // a collection that is gone means "use that one", not "fall back to whatever is here".
  it('does not fall back to detection when the configured path is missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'surco-home-'))
    const dir = join(home, 'Library', 'Pioneer', 'rekordbox')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'master.db'), 'x')

    expect(
      findRekordboxCollection({ home, platform: 'darwin', configured: '/gone/master.db' }),
    ).toBe('/gone/master.db')
  })
})
