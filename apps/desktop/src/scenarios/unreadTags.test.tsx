// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { readTags } from '../main/ffmpeg'
import type { Api } from '../preload/api'
import type { MetaRead, TrackMetadata } from '../shared/types'
import { type AppScenario, openApp } from './app'
import { makeTrack, scenarioDir } from './fixtures'

const TAGS = {
  title: 'Music Sounds Better With You',
  artist: 'Stardust',
  album: 'Music Sounds Better With You',
  grouping: 'Classics',
  publisher: 'Roulé',
  bpm: 124,
}

const UNREAD: MetaRead = {
  tags: {} as TrackMetadata,
  duration: null,
  cover: null,
  foreignTags: [],
  failed: true,
}

function sha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

// The probe of a file on a NAS can time out. main then hands back an empty read flagged
// as failed rather than losing the row, and that read is all the renderer has to write
// from: replacing the original with it would blank every tag the file carried. These
// reads fail the way main reports a timeout, for as many reads as the network is down.
function networkDownFor(reads: number): void {
  let left = reads
  const api = window.api
  ;(window as unknown as { api: Api }).api = new Proxy(api, {
    get(target, key) {
      if (key !== 'readMeta') return target[key as keyof Api]
      return async (path: string) => {
        if (left > 0) {
          left--
          return UNREAD
        }
        return target.readMeta(path)
      }
    },
  })
}

async function convertInPlace(surco: AppScenario): Promise<void> {
  await surco.convertAll()
  fireEvent.click(await screen.findByTestId('confirm-ok'))
}

describe('Replace a file whose tags could not be read, without wiping them', () => {
  let surco: AppScenario | undefined
  let source: string

  async function dropRecord(reads: number): Promise<void> {
    const folder = scenarioDir('unread-tags')
    source = join(folder, 'Stardust - Music Sounds Better With You.flac')
    makeTrack(source, TAGS)
    surco = await openApp({ settings: {}, destination: 'overwrite' })
    networkDownFor(reads)
    await surco.drop(folder)
    await screen.findByTestId('track-meta-failed')
  }

  afterEach(() => {
    surco?.close()
    surco = undefined
  })

  it('reads the file again before replacing it, and keeps every tag it had', async () => {
    await dropRecord(1)
    await convertInPlace(surco as AppScenario)
    const out = source.replace('.flac', '.aiff')
    await waitFor(() => expect(existsSync(out)).toBe(true), { timeout: 60_000 })
    await screen.findByTestId('batch-summary', {}, { timeout: 30_000 })
    expect(await readTags(out)).toMatchObject({
      album: TAGS.album,
      grouping: TAGS.grouping,
      publisher: TAGS.publisher,
      bpm: String(TAGS.bpm),
    })
    expect(surco?.errors).toEqual([])
  }, 120_000)

  it('leaves the file alone and says why while its tags still cannot be read', async () => {
    await dropRecord(Number.POSITIVE_INFINITY)
    const before = sha1(source)
    await convertInPlace(surco as AppScenario)
    const badge = await screen.findByTestId('track-status-badge', undefined, { timeout: 30_000 })
    expect(badge.getAttribute('data-tone')).toBe('danger')
    await screen.findByTestId('batch-summary', {}, { timeout: 30_000 })
    expect(sha1(source)).toBe(before)
    expect(existsSync(source.replace('.flac', '.aiff'))).toBe(false)
  }, 120_000)
})
