// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readTags } from '../main/ffmpeg'
import { type AppScenario, openApp } from './app'
import { makeTrack, scenarioDir } from './fixtures'

const CRATE = [
  { title: 'Opener', grouping: 'Deep' },
  { title: 'Builder', grouping: 'Deep, Vocal' },
  { title: 'Closer', grouping: 'Techno' },
]

function row(title: string): HTMLElement {
  const found = screen.getAllByTestId('track-row').find((r) => r.textContent?.includes(title))
  if (!found) throw new Error(`scenario: no row shows ${title}`)
  return found
}

function tags(grouping: string | undefined): string[] {
  return (grouping ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .sort()
}

// Grouping is how a DJ files a track into several crates at once ("Deep, Vocal"). Tagging
// a whole selection with one more crate is the everyday bulk edit, and the field holds a
// different list on every track: setting the field wholesale would hand each track the
// first one's list, wiping the crates the others were in.
describe('Add a grouping tag to several tracks at once, keeping the ones each already has', () => {
  let surco: AppScenario
  let folder: string

  beforeAll(async () => {
    folder = scenarioDir('bulk-grouping')
    for (const t of CRATE)
      makeTrack(join(folder, `${t.title}.flac`), {
        title: t.title,
        artist: 'A',
        grouping: t.grouping,
      })
    surco = await openApp({
      settings: { groupingPresets: ['Peak time'] },
      destination: 'beside',
    })
    await surco.drop(folder)
    await surco.select('Opener')
    fireEvent.click(row('Builder'), { metaKey: true })
    fireEvent.click(row('Closer'), { metaKey: true })
    const bulk = await screen.findByTestId('grouping-bulk')
    fireEvent.click(within(bulk).getByTestId('chip-Peak time'))
    await surco.convertAll()
    await vi.waitFor(
      () => {
        for (const t of CRATE) expect(existsSync(join(folder, `${t.title}.aiff`))).toBe(true)
      },
      { timeout: 60_000, interval: 200 },
    )
  }, 120_000)

  afterAll(() => {
    surco.close()
  })

  it.each(CRATE)(
    'writes $title with its own crates plus the new one',
    async ({ title, grouping }) => {
      const { grouping: written } = await readTags(join(folder, `${title}.aiff`))
      expect(tags(written)).toEqual(tags(`${grouping}, Peak time`))
      expect(surco.errors).toEqual([])
    },
  )
})
