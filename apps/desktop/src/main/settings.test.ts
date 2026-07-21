import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

// settings.ts persists to app.getPath('userData')/settings.json, so point Electron
// at a throwaway temp dir and exercise the real read/merge/write round-trip.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-settings-'))
  return { app: { getPath: () => dir } }
})

// Pass-through fs that records where writeFileSync lands, so the atomicity test can
// assert the live settings.json is never written in place.
const { writeTargets } = vi.hoisted(() => ({ writeTargets: [] as string[] }))
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  const writeFileSync: typeof real.writeFileSync = (path, data, opts) => {
    writeTargets.push(String(path))
    return real.writeFileSync(path, data, opts)
  }
  return { ...real, writeFileSync }
})

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import {
  getConfigDir,
  getSettings,
  recordConversion,
  recordStat,
  sanitizeSettingsPatch,
  saveSettings,
  setConfigDir,
} from './settings'

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

describe('recordConversion', () => {
  // The Stats tab is only as honest as this counter: each completed conversion
  // must bump the persisted total by exactly one and survive a reload.
  it('increments the persisted conversion count by one each time', () => {
    expect(getSettings().conversionCount).toBe(0)
    recordConversion()
    recordConversion()
    expect(getSettings().conversionCount).toBe(2)
  })
})

describe('recordStat', () => {
  // The lifetime tallies feed the same Stats tab: each bump must persist, respect
  // the batch size (a 30-file drop is one call), and leave the other counters alone.
  it('increments one counter by the given amount without touching the rest', () => {
    expect(getSettings().stats.imported).toBe(0)
    recordStat('imported', 30)
    recordStat('listened')
    expect(getSettings().stats.imported).toBe(30)
    expect(getSettings().stats.listened).toBe(1)
    expect(getSettings().stats.analyzed).toBe(0)
  })

  // The channel is exposed to the renderer, so a malformed amount must be dropped
  // rather than corrupt the persisted tally into NaN or wind it backwards.
  it('ignores non-positive and non-finite amounts', () => {
    const before = getSettings().stats.listened
    recordStat('listened', 0)
    recordStat('listened', -5)
    recordStat('listened', Number.NaN)
    expect(getSettings().stats.listened).toBe(before)
  })
})

describe('sanitizeSettingsPatch', () => {
  // stats and conversionCount are internal tallies bumped only by recordStat /
  // recordConversion — no legitimate renderer caller patches them through
  // settings:set. Left unguarded, that channel would let a compromised renderer
  // (or a bug) overwrite them directly, bypassing recordStat's own validation
  // (its NaN/negative guard) and the allowlist stats:record already enforces.
  it('drops stats and conversionCount from a patch', () => {
    const forgedStats = {
      imported: 999,
      listened: 999,
      analyzed: 999,
      discogsMatches: 999,
      bandcampMatches: 999,
    }
    expect(
      sanitizeSettingsPatch({ theme: 'dark', stats: forgedStats, conversionCount: 999 }),
    ).toEqual({ theme: 'dark' })
  })

  // commandUsage IS a legitimate renderer patch (the command palette bumps it on
  // every run), so it must survive untouched.
  it('keeps every other field, including commandUsage', () => {
    const patch = { theme: 'dark' as const, commandUsage: { add: 3 } }
    expect(sanitizeSettingsPatch(patch)).toEqual(patch)
  })

  it('is a no-op on a patch with nothing to strip', () => {
    const patch = { theme: 'light' as const }
    expect(sanitizeSettingsPatch(patch)).toEqual(patch)
  })
})

describe('nested settings from an older install', () => {
  const localFile = (): string => join(app.getPath('userData'), 'settings.json')

  // getSettings' merge is `{ ...defaults, ...local }` — shallow at the top level.
  // A settings.json written by an older Surco that predates a new stats key has an
  // object present under "stats", just missing that one field, so the shallow merge
  // takes the whole (incomplete) local object instead of filling the gap from
  // defaults. cur.stats[newKey] then reads undefined, and recordStat's
  // `cur.stats[key] + n` corrupts it to NaN — which JSON.stringifies to null,
  // permanently bricking that counter for the user on the very next read.
  it('fills a stats key an older settings.json never wrote, instead of leaving it undefined', () => {
    writeFileSync(
      localFile(),
      JSON.stringify({ stats: { imported: 5, listened: 2, analyzed: 1 } }),
    )
    expect(getSettings().stats.discogsMatches).toBe(0)
    expect(getSettings().stats.bandcampMatches).toBe(0)
    expect(getSettings().stats.imported).toBe(5)
  })

  it('recordStat never produces NaN for a key a stale settings.json omitted', () => {
    writeFileSync(localFile(), JSON.stringify({ stats: { imported: 5 } }))
    recordStat('bandcampMatches', 3)
    expect(getSettings().stats.bandcampMatches).toBe(3)
    expect(Number.isNaN(getSettings().stats.bandcampMatches)).toBe(false)
  })

  // normalize is the other fixed-shape nested object (targetLufs/truePeakDb/peakDb);
  // same shallow-merge exposure if a future field is added to it.
  it('fills a normalize field an older settings.json never wrote', () => {
    writeFileSync(localFile(), JSON.stringify({ normalize: { mode: 'peak' } }))
    const normalize = getSettings().normalize
    expect(normalize.mode).toBe('peak')
    expect(normalize.targetLufs).toBe(-14)
    expect(normalize.truePeakDb).toBe(-1)
    expect(normalize.peakDb).toBe(-1)
  })
})

describe('saveSettings atomicity', () => {
  // A crash or full disk mid-write must never truncate the live settings file:
  // getSettings' corrupt-file fallback would then silently reset every preference,
  // including the output folder and the Discogs token. The live settings.json may
  // only ever be replaced whole, never written in place.
  it('never writes the live settings.json in place', () => {
    writeTargets.length = 0
    saveSettings({ theme: 'dark' })
    expect(writeTargets.length).toBeGreaterThan(0)
    expect(writeTargets).not.toContain(join(app.getPath('userData'), 'settings.json'))
    expect(getSettings().theme).toBe('dark')
  })
})

describe('configurable settings folder', () => {
  // Users point the settings folder at iCloud Drive/Dropbox to share preferences
  // across Macs; these tests pin down the contract that makes that safe.
  const syncedFile = (dir: string): string => join(dir, 'settings.json')
  const localFile = (): string => join(app.getPath('userData'), 'settings.json')
  const read = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf-8'))

  afterEach(() => setConfigDir(null))

  it('seeds the chosen folder with current prefs and reads/writes through it', () => {
    saveSettings({ keyNotation: 'musical' })
    const dir = mkdtempSync(join(tmpdir(), 'surco-config-'))
    setConfigDir(dir)
    expect(getConfigDir()).toBe(dir)
    expect(read(syncedFile(dir)).keyNotation).toBe('musical')
    saveSettings({ keyNotation: 'camelot' })
    expect(read(syncedFile(dir)).keyNotation).toBe('camelot')
    expect(getSettings().keyNotation).toBe('camelot')
  })

  // Machine-bound values (output path, onboarding, stats) make no sense shared
  // between Macs — they stay local. The Discogs token now syncs (identical on both
  // Macs, user accepts it in their own cloud), but autoMatch still syncs with it.
  it('keeps per-machine values out of the synced file but allows the token through', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-config-'))
    setConfigDir(dir)
    saveSettings({ discogsToken: 'secret', autoMatch: true, outputDir: '/Volumes/USB' })
    const synced = read(syncedFile(dir))
    for (const key of [
      'outputDir',
      'hasSeenOnboarding',
      'conversionCount',
      'stats',
    ]) {
      expect(synced).not.toHaveProperty(key)
    }
    expect(synced.discogsToken).toBe('secret')
    expect(synced.autoMatch).toBe(true)
    expect(read(localFile()).outputDir).toBe('/Volumes/USB')
    expect(read(localFile()).discogsToken).toBeUndefined()
    expect(getSettings().discogsToken).toBe('secret')
    expect(getSettings().outputDir).toBe('/Volumes/USB')
  })

  // Pointing a second Mac at an already-populated folder must adopt those prefs,
  // not clobber them with this machine's — adopting is the whole point of syncing.
  it('adopts an existing settings file instead of overwriting it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-config-'))
    writeFileSync(syncedFile(dir), JSON.stringify({ filenameFormat: '{title}' }))
    setConfigDir(dir)
    expect(getSettings().filenameFormat).toBe('{title}')
  })

  // Going back to the default location must not lose the prefs accumulated in the
  // cloud folder: they are folded back into the local file first.
  it('keeps synced prefs when resetting to the default folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-config-'))
    setConfigDir(dir)
    saveSettings({ keyNotation: 'musical' })
    setConfigDir(null)
    expect(getConfigDir()).toBeNull()
    expect(getSettings().keyNotation).toBe('musical')
  })
})

describe('shortcutOverrides', () => {
  // Old settings files predate the field, so the defaults merge must supply an empty
  // map (no overrides) rather than leaving it undefined; a saved override survives a
  // reload like every other setting.
  it('defaults to empty and round-trips a saved override', () => {
    expect(getSettings().shortcutOverrides).toEqual({})
    saveSettings({ shortcutOverrides: { add: ['mod', 'shift', 'a'] } })
    expect(getSettings().shortcutOverrides).toEqual({ add: ['mod', 'shift', 'a'] })
  })
})

describe('token sync', () => {
  // El usuario usa dos Macs con la carpeta de config en iCloud. El token de Discogs
  // es idéntico en ambas, así que debe viajar en el fichero compartido — no quedarse
  // atrás en cada máquina. Las rutas locales sí se quedan: no existen en la otra Mac.
  it('writes the Discogs token to the synced folder but keeps outputDir local', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-sync-'))
    setConfigDir(dir)
    saveSettings({ discogsToken: 'abc123', outputDir: '/Users/me/Music' })

    const synced = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'))
    const local = JSON.parse(readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf-8'))

    expect(synced.discogsToken).toBe('abc123')
    expect(synced.outputDir).toBeUndefined()
    expect(local.outputDir).toBe('/Users/me/Music')
    expect(local.discogsToken).toBeUndefined()

    setConfigDir(null)
    rmSync(dir, { recursive: true, force: true })
  })
})
