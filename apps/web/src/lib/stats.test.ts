import { describe, expect, it } from 'vitest'
import {
  type Day,
  installsInLast,
  recordSnapshot,
  releaseTotals,
  type StatsRelease,
  usage,
  versions,
  weeklyInstalls,
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

  it('counts a Windows install only when the installer was fetched without its blockmap, which every update downloads', () => {
    const r = release('v1.0.0', '2026-10-01T00:00:00Z', [
      asset('Surco-1.0.0-Setup.exe', 12),
      asset('Surco-1.0.0-Setup.exe.blockmap', 9),
    ])
    expect(releaseTotals(r).windows).toBe(3)
  })

  it('takes the release bot count off a Windows installer published without a blockmap', () => {
    const r = release('v1.0.0', '2026-10-01T00:00:00Z', [
      asset('Surco-1.0.0-arm64.dmg.blockmap', 1),
      asset('Surco-1.0.0-x64.dmg.blockmap', 3),
      asset('Surco-1.0.0-Setup.exe', 12),
    ])
    expect(releaseTotals(r).windows).toBe(10)
  })

  it('leaves Linux out, where automatic fetches outnumber people and cannot be told apart', () => {
    const r = release('v1.0.0', '2026-10-01T00:00:00Z', [asset('Surco-1.0.0-x86_64.AppImage', 5)])
    expect(releaseTotals(r)).toEqual({ mac: 0, windows: 0 })
  })

  it('leaves out the update feeds and archives the app polls on every launch', () => {
    const r = release('v1.0.0', '2026-10-01T00:00:00Z', [
      asset('latest-mac.yml', 500),
      asset('latest.yml', 300),
      asset('Surco-1.0.0-arm64.zip', 40),
    ])
    expect(releaseTotals(r)).toEqual({ mac: 0, windows: 0 })
  })
})

describe('versions', () => {
  const releases = [
    release('v1.1.0', '2026-10-02T00:00:00Z', [
      asset('Surco-1.1.0-arm64.zip', 9),
      asset('Surco-1.1.0-x64.zip', 3),
      asset('Surco-1.1.0-arm64.dmg', 5),
      asset('Surco-1.1.0-arm64.dmg.blockmap', 1),
      asset('Surco-1.1.0-Setup.exe', 8),
      asset('Surco-1.1.0-Setup.exe.blockmap', 6),
    ]),
    release('v1.2.0-beta.0', '2026-10-03T00:00:00Z', [asset('Surco-arm64.zip', 2)], true),
    release('v1.0.0', '2026-10-01T00:00:00Z', [asset('Surco-1.0.0-arm64.zip', 5)]),
  ]

  it('counts the Macs and PCs the updater moved to each stable version, newest first, without bots or betas', () => {
    expect(versions(releases, 8)).toMatchObject([
      { version: 'v1.1.0', mac: 10, windows: 5 },
      { version: 'v1.0.0', mac: 5, windows: 0 },
    ])
  })

  it('carries no time-as-newest figure, which the page no longer shows', () => {
    expect(versions(releases, 8)[0]).not.toHaveProperty('hours')
  })

  it('adds the new installs each version brought on Mac and Windows', () => {
    expect(versions(releases, 8)[0].installs).toBe(6)
  })

  it('keeps only as many versions as asked for', () => {
    const three = ['1', '2', '3'].map((n) =>
      release(`v1.${n}.0`, `2026-10-0${n}T00:00:00Z`, [asset('a.zip', 1)]),
    )
    expect(versions(three, 2).map((v) => v.version)).toEqual(['v1.3.0', 'v1.2.0'])
  })
})

describe('usage', () => {
  it('takes the most updated version of each week as the least number of computers running Surco', () => {
    const releases = [
      release('v1.0.0', '2026-10-05T00:00:00Z', [asset('a.zip', 4), asset('a.exe.blockmap', 7)]),
      release('v1.1.0', '2026-10-07T00:00:00Z', [asset('a.zip', 9), asset('a.exe.blockmap', 2)]),
      release('v1.2.0', '2026-10-12T00:00:00Z', [asset('a.zip', 3)]),
      release('v1.3.0-beta.0', '2026-10-13T00:00:00Z', [asset('a.zip', 50)], true),
    ]
    expect(usage(releases)).toEqual([
      { week: '2026-10-05', mac: 9, windows: 7 },
      { week: '2026-10-12', mac: 3, windows: 0 },
    ])
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
      { date: '2026-10-01', mac: 2, windows: 0, estimated: true },
      { date: '2026-10-02', mac: 4, windows: 0, estimated: true },
      { date: '2026-10-03', mac: 7, windows: 1, estimated: true },
      { date: '2026-10-04', mac: 10, windows: 2 },
    ])
  })

  it('ends on the measured totals of today, which are not an estimate', () => {
    const { days } = recordSnapshot(null, releases, '2026-10-04')
    expect(days.at(-1)).toEqual({ date: '2026-10-04', mac: 10, windows: 2 })
  })

  // Once snapshots exist they are the history: rebuilding again would rewrite measured
  // days with an estimate made from later counts.
  it('appends to an existing history instead of rebuilding it', () => {
    const previous = {
      days: [{ date: '2026-10-03', mac: 9, windows: 1 }],
      versions: [],
      usage: [],
    }
    expect(recordSnapshot(previous, releases, '2026-10-04').days).toEqual([
      { date: '2026-10-03', mac: 9, windows: 1 },
      { date: '2026-10-04', mac: 10, windows: 2 },
    ])
  })

  it('replaces the entry of a day that runs twice', () => {
    const previous = {
      days: [
        { date: '2026-10-03', mac: 9, windows: 1 },
        { date: '2026-10-04', mac: 9, windows: 1 },
      ],
      versions: [],
      usage: [],
    }
    expect(recordSnapshot(previous, releases, '2026-10-04').days).toHaveLength(2)
    expect(recordSnapshot(previous, releases, '2026-10-04').days.at(-1)?.mac).toBe(10)
  })

  it('rebuilds a history recorded when Windows counted updates, whose figures cannot continue as installs', () => {
    const previous = {
      days: [{ date: '2026-10-03', mac: 9, windows: 40, linux: 3 }],
      versions: [],
      usage: [],
    }
    expect(recordSnapshot(previous, releases, '2026-10-04').days[2]).toEqual({
      date: '2026-10-03',
      mac: 7,
      windows: 1,
      estimated: true,
    })
  })

  it('skips drafts, which have no publication date and nobody can download', () => {
    const withDraft = [
      ...releases,
      { tag_name: 'v9.0.0', published_at: null, assets: [asset('x.dmg', 3)] },
    ]
    expect(recordSnapshot(null, withDraft, '2026-10-04').days.at(-1)?.mac).toBe(10)
  })
})

const day = (date: string, mac: number, windows = 0): Day => ({ date, mac, windows })

describe('installsInLast', () => {
  it('counts the Mac and Windows installs of the last days asked for', () => {
    const days = [
      day('2026-10-20', 100, 50),
      day('2026-10-23', 110, 52),
      day('2026-10-27', 130, 60),
    ]
    expect(installsInLast(days, 7)).toBe(40)
    expect(installsInLast(days, 4)).toBe(28)
  })

  it('counts from the first day when the history is shorter than a week', () => {
    expect(installsInLast([day('2026-10-25', 100), day('2026-10-27', 104)], 7)).toBe(4)
  })
})

describe('weeklyInstalls', () => {
  it('turns the running totals into new installs per week and system, starting on Monday', () => {
    const days = [
      day('2026-10-05', 10, 1),
      day('2026-10-11', 14, 3),
      day('2026-10-12', 15, 3),
      day('2026-10-18', 25, 8),
    ]
    expect(weeklyInstalls(days)).toEqual([
      { week: '2026-10-05', mac: 14, windows: 3 },
      { week: '2026-10-12', mac: 11, windows: 5 },
    ])
  })

  it('carries a week with no snapshot as zero instead of dropping it', () => {
    const days = [day('2026-10-05', 10), day('2026-10-19', 12)]
    expect(weeklyInstalls(days).map((w) => w.mac)).toEqual([10, 0, 2])
  })
})
