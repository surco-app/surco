import { describe, expect, it } from 'vitest'
import {
  keepsOutputCopy,
  planFromSettings,
  planToSettings,
  withAppleMusic,
  withEngineDj,
  withLocation,
} from './destination'

const OLD_RADIO = {
  folder: {
    addToAppleMusic: false,
    keepOutputCopy: true,
    overwriteOriginal: false,
    addToEngineDj: false,
    convertBesideOriginal: false,
  },
  appleMusic: {
    addToAppleMusic: true,
    keepOutputCopy: false,
    overwriteOriginal: false,
    addToEngineDj: false,
    convertBesideOriginal: false,
  },
  engineDj: {
    addToAppleMusic: false,
    keepOutputCopy: true,
    overwriteOriginal: false,
    addToEngineDj: true,
    convertBesideOriginal: false,
  },
  beside: {
    addToAppleMusic: false,
    keepOutputCopy: true,
    overwriteOriginal: false,
    addToEngineDj: false,
    convertBesideOriginal: true,
  },
  overwrite: {
    addToAppleMusic: false,
    keepOutputCopy: true,
    overwriteOriginal: true,
    addToEngineDj: false,
    convertBesideOriginal: false,
  },
}

describe('planFromSettings reads every setting the old destination radio wrote', () => {
  it('output folder: saved in the folder, no DJ software', () => {
    expect(planFromSettings(OLD_RADIO.folder, false)).toEqual({
      location: 'folder',
      appleMusic: false,
      engineDj: false,
      keepOutputCopy: true,
    })
  })

  it('Apple Music: saved through the folder into Music, with no copy left behind', () => {
    const plan = planFromSettings(OLD_RADIO.appleMusic, false)
    expect(plan).toEqual({
      location: 'folder',
      appleMusic: true,
      engineDj: false,
      keepOutputCopy: false,
    })
    expect(keepsOutputCopy(plan)).toBe(false)
  })

  it('Engine DJ: saved in the folder, where the Engine row points', () => {
    const plan = planFromSettings(OLD_RADIO.engineDj, false)
    expect(plan).toEqual({
      location: 'folder',
      appleMusic: false,
      engineDj: true,
      keepOutputCopy: true,
    })
    expect(keepsOutputCopy(plan)).toBe(true)
  })

  it('beside the original: no library', () => {
    expect(planFromSettings(OLD_RADIO.beside, false)).toMatchObject({
      location: 'beside',
      appleMusic: false,
      engineDj: false,
    })
  })

  it('overwrite: no library, and it wins over a leftover beside flag', () => {
    expect(
      planFromSettings({ ...OLD_RADIO.overwrite, convertBesideOriginal: true }, false),
    ).toMatchObject({ location: 'overwrite', appleMusic: false, engineDj: false })
  })

  it('writes each old choice back to the exact booleans it was read from', () => {
    for (const stored of Object.values(OLD_RADIO)) {
      expect(planToSettings(planFromSettings(stored, false))).toEqual(stored)
    }
  })

  it('keeps FLAC out of Apple Music while Engine DJ still takes it', () => {
    expect(planFromSettings({ ...OLD_RADIO.appleMusic, addToEngineDj: true }, true)).toMatchObject({
      appleMusic: false,
      engineDj: true,
    })
  })
})

describe('changing the plan', () => {
  const folder = planFromSettings(OLD_RADIO.folder, false)

  it('Apple Music starts without a folder copy, as the old destination did', () => {
    expect(withAppleMusic(folder, true)).toMatchObject({ appleMusic: true, keepOutputCopy: false })
  })

  it('Engine DJ keeps the folder copy even beside an Apple Music only add', () => {
    expect(keepsOutputCopy(withEngineDj(withAppleMusic(folder, true), true))).toBe(true)
  })

  it('saving beside or over the original leaves every library', () => {
    const both = withEngineDj(withAppleMusic(folder, true), true)
    for (const location of ['beside', 'overwrite'] as const) {
      expect(withLocation(both, location)).toMatchObject({
        location,
        appleMusic: false,
        engineDj: false,
      })
    }
  })

  it('going back to the folder keeps what was ticked', () => {
    const both = withEngineDj(withAppleMusic(folder, true), true)
    expect(withLocation(both, 'folder')).toEqual(both)
  })
})
