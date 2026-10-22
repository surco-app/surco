import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it } from 'vitest'
import { findDrops, nearestBeat } from '../shared/cueRules'
import { type DropInput, detectDrops } from '../shared/dropDetect'
import type { TrackCues } from '../shared/types'
import { runCueWaveWords } from './cueWaveWords'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readCueWaveDetail, readTrackCues } from './rekordboxCues'
import { openRekordboxDb, rekordboxRawKey } from './rekordboxDb'

const copy = process.env.SURCO_CUE_WORDS_DB
const limit = Number(process.env.SURCO_CUE_WORDS_TRACKS ?? 60)
const SCRATCH = '/private/tmp/claude-501/'

interface Track {
  grid: TrackCues['grid']
  phrases: TrackCues['phrases']
  rekordbox: Uint16Array
  surco: Uint16Array
  mine: number[]
}

interface Tally {
  tracks: number
  drops: number
  hit: number
  proposals: number
  right: number
}

function hashOf(text: string): number {
  let h = 2166136261
  for (const c of text) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

function barOf(grid: Track['grid'], ms: number): number {
  const index = nearestBeat(
    grid.map((b) => b.ms),
    ms,
  )
  return grid.slice(0, index + 1).filter((b) => b.beat === 1).length
}

function tally(tracks: Track[], propose: (t: Track) => number[]): Tally {
  const t: Tally = { tracks: 0, drops: 0, hit: 0, proposals: 0, right: 0 }
  for (const track of tracks) {
    const offered = propose(track).map((ms) => barOf(track.grid, ms))
    const mine = track.mine.map((ms) => barOf(track.grid, ms))
    t.tracks++
    t.drops += mine.length
    t.proposals += offered.length
    t.hit += mine.filter((b) => offered.includes(b)).length
    t.right += offered.filter((b) => mine.includes(b)).length
  }
  return t
}

function rates(t: Tally) {
  const r = (x: number): number => Math.round(x * 1000) / 1000
  return {
    tracks: t.tracks,
    drops: t.drops,
    recall: r(t.hit / t.drops),
    precision: r(t.proposals ? t.right / t.proposals : 0),
    proposalsPerTrack: r(t.proposals / t.tracks),
  }
}

function sampleRateOf(file: string): number {
  const probe = spawnSync(ffprobeInstaller.path, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate',
    '-of',
    'csv=p=0',
    file,
  ])
  return Number(String(probe.stdout).trim())
}

describe.skipIf(!copy)(
  'Auto marcar on Surco’s own wave words against the drops the DJ marked',
  () => {
    it('compares rekordbox’s words with and without phrases and Surco’s words, on held-out tracks of a copy', async () => {
      const path = resolve(copy as string)
      expect(path.startsWith(SCRATCH) && !path.includes('/Library/Pioneer')).toBe(true)
      const db =
        openRekordboxDb(path, { readonly: true }) ??
        openRekordboxDb(path, { readonly: true, key: await rekordboxRawKey(path) })
      if (!db) throw new Error('the copy did not open')
      const share = rekordboxShareDir(path)
      const ids = (
        db
          .prepare('SELECT DISTINCT ContentID FROM djmdCue WHERE coalesce(rb_local_deleted, 0) = 0')
          .all() as { ContentID: string }[]
      )
        .map((r) => String(r.ContentID))
        .filter((id) => hashOf(id) % 10 >= 7)
        .sort((a, b) => hashOf(a) - hashOf(b))
      const tracks: Track[] = []
      for (const id of ids) {
        if (tracks.length >= limit) break
        const read = readTrackCues(db, share, id, { wave: false })
        if (!read?.analysed || read.phrases.length === 0) continue
        const mine = findDrops(
          read.cues.filter((c) => c.kind === 0).map((c) => c.ms),
          read.cues.filter((c) => c.kind !== 0).map((c) => c.ms),
        )
        const rekordbox = readCueWaveDetail(db, share, id)
        const row = db.prepare('SELECT FolderPath FROM djmdContent WHERE ID = ?').get(id) as {
          FolderPath: string
        }
        if (mine.length === 0 || !rekordbox || !existsSync(row.FolderPath)) continue
        const rate = sampleRateOf(row.FolderPath)
        if (!rate) continue
        const surco = await runCueWaveWords(
          row.FolderPath,
          ffmpegStatic as unknown as string,
          rate,
          600_000,
        ).catch(() => null)
        if (!surco) continue
        tracks.push({ grid: read.grid, phrases: read.phrases, rekordbox, surco, mine })
      }
      db.close()
      const report = (name: string, input: (t: Track) => DropInput) =>
        process.stdout.write(
          `${JSON.stringify({ family: name, ...rates(tally(tracks, (t) => detectDrops(input(t)))) })}\n`,
        )
      report('rekordbox words + phrases', (t) => ({
        grid: t.grid,
        phrases: t.phrases,
        words: t.rekordbox,
      }))
      report('rekordbox words, no phrases', (t) => ({
        grid: t.grid,
        phrases: [],
        words: t.rekordbox,
      }))
      report('Surco words, no phrases', (t) => ({ grid: t.grid, phrases: [], words: t.surco }))
      expect(tracks.length).toBeGreaterThan(0)
    }, 7_200_000)
  },
)
