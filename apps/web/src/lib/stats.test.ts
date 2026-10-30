import { describe, expect, it } from 'vitest'
import {
  type Day,
  installsInLast,
  lastTwelveMonths,
  macUpdates,
  recordSnapshot,
  releaseTotals,
  type StatsRelease,
  weeklyMacInstalls,
} from './stats'

const asset = (name: string, download_count: number) => ({ name, download_count })

function release(
  tag: string,
  published_at: string,
  assets: { name: string; download_count: number }[],
  prerelease = false,
): StatsRelease {
  return { tag_name: tag, published_at, prerelease, assets }
}

describe('releaseTotals', () => {
  // Crawlers fetch every file of every release once, the .dmg.blockmap included, which no
  // person or updater ever asks for. That one file is the bot count to take off the rest.
  it('takes each dmg blockmap off its installer, since only bots fetch it', () => {
    const r = release('v1.0.0', '2026-10-01T00:00:00Z', [
      asset('Surco-1.0.0-arm64.dmg', 10),
      asset('Surco-1.0.0-arm64.dmg.blockmap', 2),
      asset('Surco-1.0.0-x64.dmg', 1),
      asset('Surco-1.0.0-x64.dmg.blockmap', 1),
    ])
    expect(releaseTotals(r).mac).toBe(8)
  })

  it('never lets a busier blockmap push an installer below zero', () => {
    const r = release('v1.0.0', '2026-10-01T00:00:00Z', [
      asset('Surco-1.0.0-x64.dmg', 1),
      asset('Surco-1.0.0-x64.dmg.blockmap', 3),
    ])
    expect(releaseTotals(r).mac).toBe(0)
  })

  // The Windows and Linux installers have no bot-only twin (the updater reads the .exe
  // blockmap), so they take off the bot count the same release's dmg blockmaps measured.
  it('takes the release bot count off the Windows and Linux installers', () => {
    const r = release('v1.0.0', '2026-10-01T00:00:00Z', [
      asset('Surco-1.0.0-arm64.dmg.blockmap', 1),
      asset('Surco-1.0.0-x64.dmg.blockmap', 3),
      asset('Surco-1.0.0-Setup.exe', 12),
      asset('Surco-1.0.0-Setup.exe.blockmap', 9),
      asset('Surco-1.0.0-x86_64.AppImage', 5),
    ])
    expect(releaseTotals(r)).toMatchObject({ windows: 10, linux: 3 })
  })

  it('leaves out the update feeds and archives the app polls on every launch', () => {
    const r = release('v1.0.0', '2026-10-01T00:00:00Z', [
      asset('latest-mac.yml', 500),
      asset('latest.yml', 300),
      asset('Surco-1.0.0-arm64.zip', 40),
    ])
    expect(releaseTotals(r)).toMatchObject({ mac: 0, windows: 0, linux: 0 })
  })
})

describe('macUpdates', () => {
  // The .zip is only ever fetched by the Mac updater, so it counts Macs that moved to each
  // version: the closest thing to active use without telemetry. Betas reach only opted-in
  // users and would read as a collapse.
  it('counts the zips of the newest stable releases, newest first, without bots', () => {
    const releases = [
      release('v1.1.0', '2026-10-02T00:00:00Z', [
        asset('Surco-1.1.0-arm64.zip', 9),
        asset('Surco-1.1.0-x64.zip', 3),
        asset('Surco-1.1.0-arm64.dmg.blockmap', 1),
      ]),
      release('v1.2.0-beta.0', '2026-10-03T00:00:00Z', [asset('Surco-arm64.zip', 2)], true),
      release('v1.0.0', '2026-10-01T00:00:00Z', [asset('Surco-1.0.0-arm64.zip', 5)]),
    ]
    expect(macUpdates(releases, 8)).toEqual([
      { version: 'v1.1.0', count: 10 },
      { version: 'v1.0.0', count: 5 },
    ])
  })

  it('keeps only as many versions as asked for', () => {
    const releases = ['1', '2', '3'].map((n) =>
      release(`v1.${n}.0`, `2026-10-0${n}T00:00:00Z`, [asset('a.zip', 1)]),
    )
    expect(macUpdates(releases, 2).map((u) => u.version)).toEqual(['v1.3.0', 'v1.2.0'])
  })
})

describe('recordSnapshot', () => {
  const releases = [
    release('v1.0.0', '2026-10-01T00:00:00Z', [asset('Surco-1.0.0.dmg', 4)]),
    release('v1.1.0', '2026-10-03T00:00:00Z', [
      asset('Surco-1.1.0.dmg', 6),
      asset('Surco-1.1.0-Setup.exe', 2),
    ]),
  ]

  // GitHub keeps only today's totals. The web always serves the newest installer, so a
  // release's downloads fell between its publication and the next one: spreading them over
  // that window rebuilds a curve for the days before the first snapshot.
  it('rebuilds the days before the first snapshot from each release window', () => {
    const { days } = recordSnapshot(null, releases, '2026-10-04')
    expect(days).toEqual([
      { date: '2026-10-01', mac: 2, windows: 0, linux: 0, estimated: true },
      { date: '2026-10-02', mac: 4, windows: 0, linux: 0, estimated: true },
      { date: '2026-10-03', mac: 7, windows: 1, linux: 0, estimated: true },
      { date: '2026-10-04', mac: 10, windows: 2, linux: 0 },
    ])
  })

  it('ends on the measured totals of today, which are not an estimate', () => {
    const { days } = recordSnapshot(null, releases, '2026-10-04')
    expect(days.at(-1)).toEqual({ date: '2026-10-04', mac: 10, windows: 2, linux: 0 })
  })

  // Once snapshots exist they are the history: rebuilding again would rewrite measured
  // days with an estimate made from later counts.
  it('appends to an existing history instead of rebuilding it', () => {
    const previous = {
      days: [{ date: '2026-10-03', mac: 9, windows: 1, linux: 0 }],
      macUpdates: [],
    }
    expect(recordSnapshot(previous, releases, '2026-10-04').days).toEqual([
      { date: '2026-10-03', mac: 9, windows: 1, linux: 0 },
      { date: '2026-10-04', mac: 10, windows: 2, linux: 0 },
    ])
  })

  it('replaces the entry of a day that runs twice', () => {
    const previous = {
      days: [
        { date: '2026-10-03', mac: 9, windows: 1, linux: 0 },
        { date: '2026-10-04', mac: 9, windows: 1, linux: 0 },
      ],
      macUpdates: [],
    }
    expect(recordSnapshot(previous, releases, '2026-10-04').days).toHaveLength(2)
    expect(recordSnapshot(previous, releases, '2026-10-04').days.at(-1)?.mac).toBe(10)
  })

  it('skips drafts, which have no publication date and nobody can download', () => {
    const withDraft = [
      ...releases,
      { tag_name: 'v9.0.0', published_at: null, assets: [asset('x.dmg', 3)] },
    ]
    expect(recordSnapshot(null, withDraft, '2026-10-04').days.at(-1)?.mac).toBe(10)
  })
})

const day = (date: string, mac: number, estimated?: true): Day => ({
  date,
  mac,
  windows: 0,
  linux: 0,
  ...(estimated && { estimated }),
})

describe('installsInLast', () => {
  it('counts the Mac installs of the last days asked for', () => {
    const days = [day('2026-10-20', 100), day('2026-10-23', 110), day('2026-10-27', 130)]
    expect(installsInLast(days, 7)).toBe(30)
    expect(installsInLast(days, 4)).toBe(20)
  })

  it('counts from the first day when the history is shorter than a week', () => {
    expect(installsInLast([day('2026-10-25', 100), day('2026-10-27', 104)], 7)).toBe(4)
  })
})

describe('weeklyMacInstalls', () => {
  // A cumulative curve flattens a change of pace into a gentle bend; new installs per week
  // show it.
  it('turns the cumulative curve into new installs per week, starting on Monday', () => {
    const days = [
      day('2026-10-05', 10),
      day('2026-10-11', 14),
      day('2026-10-12', 15),
      day('2026-10-18', 25),
    ]
    expect(weeklyMacInstalls(days)).toEqual([
      { week: '2026-10-05', count: 14 },
      { week: '2026-10-12', count: 11 },
    ])
  })

  it('carries a week with no snapshot as zero instead of dropping it', () => {
    const days = [day('2026-10-05', 10), day('2026-10-19', 12)]
    expect(weeklyMacInstalls(days).map((w) => w.count)).toEqual([10, 0, 2])
  })
})

describe('lastTwelveMonths', () => {
  // The curve starts on the first day ever stored, so every month added squeezes the rest
  // into the same width until the month labels collide. A year keeps the recent pace
  // readable.
  it('keeps the days from the same date a year before the latest one', () => {
    const days = [
      day('2025-10-29', 1),
      day('2025-10-30', 2),
      day('2026-03-01', 50),
      day('2026-10-30', 273),
    ]
    expect(lastTwelveMonths(days).map((d) => d.date)).toEqual([
      '2025-10-30',
      '2026-03-01',
      '2026-10-30',
    ])
  })

  it('keeps a history shorter than a year whole', () => {
    const days = [day('2026-06-02', 4), day('2026-10-30', 273)]
    expect(lastTwelveMonths(days)).toEqual(days)
  })
})
