// @vitest-environment jsdom
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { isRekordboxRunning } from '../main/rekordboxProcess'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'
import { makeRekordbox, rekordboxPaths } from './rekordboxFixture'

function collectionWithAnotherTrack(root: string): string {
  return makeRekordbox(join(root, 'rekordbox'), [
    {
      id: '900001',
      path: join(root, 'Elsewhere', 'Show Me Love.mp3'),
      title: 'Show Me Love',
      artist: 'Robin S',
      fileType: 1,
    },
  ])
}

function downloadedTrack(root: string): { folder: string; output: string } {
  const folder = join(root, 'Downloads')
  makeTrack(join(folder, 'Plastic Dreams.flac'), { title: 'Plastic Dreams', artist: 'Jaydee' })
  return { folder, output: join(folder, 'Plastic Dreams.aiff') }
}

describe.skipIf(process.platform !== 'darwin')(
  'New tracks reach rekordbox when the DJ asks for them',
  () => {
    describe('converting a download with "add the new ones" on', () => {
      let surco: Scenario
      let db: string
      let output: string

      beforeAll(async () => {
        const root = scenarioDir('add-to-rekordbox')
        db = collectionWithAnotherTrack(root)
        const track = downloadedTrack(root)
        output = track.output
        vi.mocked(isRekordboxRunning).mockResolvedValue(false)
        surco = await openSurco({
          settings: {
            outputFormat: 'aiff',
            syncRekordbox: true,
            addToRekordbox: true,
            rekordboxDbPath: db,
          },
          destination: 'beside',
        })
        await surco.drop(track.folder)
        await surco.convertAll()
      }, 120_000)

      it('a converted track reaches rekordbox with no playlist chosen', () => {
        expect(rekordboxPaths(db)).toContain(output)
      })

      it('keeps the track rekordbox already had', () => {
        expect(rekordboxPaths(db)).toHaveLength(2)
      })

      it('runs without a single error the user would see', () => {
        expect(surco.errors).toEqual([])
      })
    })

    describe('converting while rekordbox is open', () => {
      let surco: Scenario
      let db: string
      let output: string
      let whileOpen: string[]
      let waiting: number

      beforeAll(async () => {
        const root = scenarioDir('add-to-rekordbox-open')
        db = collectionWithAnotherTrack(root)
        const track = downloadedTrack(root)
        output = track.output
        vi.mocked(isRekordboxRunning).mockResolvedValue(true)
        surco = await openSurco({
          settings: {
            outputFormat: 'aiff',
            syncRekordbox: true,
            addToRekordbox: true,
            rekordboxDbPath: db,
          },
          destination: 'beside',
        })
        await surco.drop(track.folder)
        await surco.convertAll()
        whileOpen = rekordboxPaths(db)
        waiting = surco.rekordboxWaiting()
        vi.mocked(isRekordboxRunning).mockResolvedValue(false)
        await surco.rekordboxClosed()
      }, 120_000)

      it('the add waits while rekordbox is open, so its database is never written under it', () => {
        expect(whileOpen).not.toContain(output)
        expect(waiting).toBe(1)
      })

      it('lands the waiting add once rekordbox closes', () => {
        expect(rekordboxPaths(db)).toContain(output)
        expect(surco.rekordboxWaiting()).toBe(0)
      })
    })

    describe('converting with "update the ones already there" only', () => {
      let db: string

      beforeAll(async () => {
        const root = scenarioDir('update-rekordbox-only')
        db = collectionWithAnotherTrack(root)
        const track = downloadedTrack(root)
        vi.mocked(isRekordboxRunning).mockResolvedValue(false)
        const surco = await openSurco({
          settings: {
            outputFormat: 'aiff',
            syncRekordbox: true,
            addToRekordbox: false,
            rekordboxDbPath: db,
          },
          destination: 'beside',
        })
        await surco.drop(track.folder)
        await surco.convertAll()
      }, 120_000)

      it('nothing is registered with rekordbox on update only, so the collection holds only what the DJ put there', () => {
        expect(rekordboxPaths(db)).toHaveLength(1)
      })
    })
  },
)
