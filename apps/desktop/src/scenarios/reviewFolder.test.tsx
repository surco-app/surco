// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { act, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/applemusic', async (original) => ({
  ...(await import('./fakeMusic')).appleMusicModule(await original()),
  scenarioFake: true,
}))
vi.mock('../main/appleMusicPlaylists', async () => (await import('./fakeMusic')).playlistsModule())
vi.mock('../main/appleMusicArtwork', async (original) =>
  (await import('./fakeMusic')).artworkModule(await original()),
)

import { snapshotTags } from '../main/tagSnapshot'
import type { MusicReview } from '../renderer/src/hooks/useMusicReview'
import { osTrash } from './electronFake'
import { listFiles, makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

describe('Review a folder before it goes into your library', () => {
  let folder: string
  let surco: Scenario
  let review: () => MusicReview
  let notice: { spelling: number; duplicates: number }
  let stagedOnOpen: string[]
  let keptByDefault: string | undefined
  let backupsAfterApply: string[]
  let afterApply: Record<string, string[]>
  const key = (kind: 'case' | 'typo') =>
    review().spelling.find((g) => g.kind === kind)?.key ?? `no ${kind} group`

  beforeAll(async () => {
    folder = scenarioDir('review-folder')
    makeTrack(join(folder, 'one.flac'), { title: 'Around The World', artist: 'Daft Punk' })
    makeTrack(join(folder, 'two.flac'), { title: 'Da Funk', artist: 'Daft Punk' })
    makeTrack(join(folder, 'three.aiff'), { title: 'Revolution 909', artist: 'Daft punk' })
    makeTrack(join(folder, 'four.flac'), { title: 'Song A', artist: 'Armin van Buuren' })
    makeTrack(join(folder, 'five.flac'), { title: 'Song B', artist: 'Armin van Buuren' })
    makeTrack(join(folder, 'six.flac'), { title: 'Song C', artist: 'Armin van Buren' })
    makeTrack(join(folder, 'omt.mp3'), { title: 'One More Time', artist: 'Daft Punk' })
    makeTrack(join(folder, 'omt.flac'), { title: 'One More Time', artist: 'Daft Punk' })

    surco = await openSurco({ settings: {} })
    await surco.drop(folder)
    const groups = surco.reviewNotice(surco.tracks().map((t) => t.inputPath))
    notice = { spelling: groups.spelling, duplicates: groups.duplicates }

    review = await surco.openListReview()
    await waitFor(() => expect(review().duplicates[0]?.locations).not.toEqual({}))
    expect(
      review()
        .spelling.map((g) => g.kind)
        .sort(),
    ).toEqual(['case', 'typo'])
    stagedOnOpen = [...review().staged]
    const card = review().duplicates[0]
    keptByDefault = basename(review().choice(card.group.key) ?? '')
    act(() => review().choose(key('case'), 'Daft Punk'))
    act(() => review().toggleStaged(key('case')))
    act(() => review().ignore(key('typo')))
    act(() => review().toggleStaged(card.group.key))
    await act(async () => review().apply())
    backupsAfterApply = (await surco.trash.list()).map((e) => basename(e.originalPath)).sort()
    afterApply = Object.fromEntries(
      listFiles(folder).map((f) => [
        f,
        snapshotTags(join(folder, f)).filter((l) => l.includes('TPE1') || l.includes('ARTIST=')),
      ]),
    )
    await act(async () => review().undo())
  }, 120_000)

  it('offers a review when the folder has spellings to unify and repeated tracks', () => {
    expect(notice).toEqual({ spelling: 2, duplicates: 1 })
  })

  it('puts nothing in the run on its own, a possible typo included', () => {
    expect(stagedOnOpen).toEqual([])
  })

  it('keeps the copy in the better format by default', () => {
    expect(keptByDefault).toBe('omt.flac')
  })

  it('writes the chosen spelling into the file that had the other one', () => {
    expect(afterApply['three.aiff']).toEqual(['id3 TPE1=Daft Punk'])
  })

  it('leaves the typo the user said is not the same artist alone', () => {
    expect(afterApply['six.flac']).toEqual(['xiph ARTIST=Armin van Buren'])
  })

  it('backs up every file before touching it', () => {
    expect(backupsAfterApply).toContain('three.aiff')
  })

  it('sends the removed copy to the Trash and out of the list', () => {
    expect(existsSync(join(folder, 'omt.mp3'))).toBe(false)
    expect(osTrash.map((p) => basename(p))).toEqual(['omt.mp3'])
    expect(surco.tracks().some((t) => basename(t.inputPath) === 'omt.mp3')).toBe(false)
  })

  it('brings the corrections back on Undo, but not the removed copy', () => {
    expect(snapshotTags(join(folder, 'three.aiff'))).toContain('id3 TPE1=Daft punk')
    expect(existsSync(join(folder, 'omt.mp3'))).toBe(false)
  })

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
  })
})
