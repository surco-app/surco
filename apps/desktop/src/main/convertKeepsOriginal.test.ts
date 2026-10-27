import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { removeRenamedOriginal } from './inplace'
import { configureOriginalKeeper, policyKeeper } from './originalKeeper'
import { createSurcoTrash } from './surcoTrash'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-keeps-original-'))
const trash = createSurcoTrash(join(dir, 'trash'))

const meta: TrackMetadata = {
  title: 'Kept',
  artist: 'A',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

function encode(name: string): string {
  const out = join(dir, name)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:a',
    'libmp3lame',
    out,
  ])
  return out
}

beforeAll(() => {
  configureOriginalKeeper((path, reason, outputPath) => trash.stash(path, reason, outputPath))
})
afterAll(() => configureOriginalKeeper(null))

// "Replace the original" lands the converted file on the source's own path. Before the
// trash existed that rename was the end of the source; now the source goes into Surco's
// trash first, so a conversion that turns out wrong is a restore rather than a loss.
describe('a conversion that lands on its own source', () => {
  it('keeps the original in the trash and puts the conversion in its place', async () => {
    const src = encode('rewrite.mp3')
    const originalBytes = readFileSync(src)
    await convertAudio(src, src, 'mp3', meta)

    const entries = await trash.list()
    const kept = entries.find((e) => e.originalPath === src)
    expect(kept).toMatchObject({ reason: 'replaced', outputPath: src, bytes: originalBytes.length })
    expect(readFileSync(kept?.storedPath as string).equals(originalBytes)).toBe(true)
    expect(existsSync(src)).toBe(true)
    expect(statSync(src).size).not.toBe(0)
  })

  it('can be undone: restoring puts the original back and parks the conversion', async () => {
    const src = encode('undo.mp3')
    const originalBytes = readFileSync(src)
    await convertAudio(src, src, 'mp3', meta)
    const kept = (await trash.list()).find((e) => e.originalPath === src)
    const { displaced } = await trash.restore(kept?.id as string)
    expect(readFileSync(src).equals(originalBytes)).toBe(true)
    expect(displaced?.reason).toBe('restored-over')
  })
})

// "Overwrite" in the conflict prompt lands the conversion on a file that is not its
// source: another track that happened to resolve to the same name. That file was renamed
// over with no copy anywhere, the one overwrite in the app with no way back.
describe('a conversion that overwrites a different file', () => {
  const overwrite = (src: string, dest: string) =>
    convertAudio(
      src,
      dest,
      'mp3',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    )

  it('keeps the file it lands on in the trash', async () => {
    const src = encode('incoming.mp3')
    const victim = encode('already-there.mp3')
    const victimBytes = readFileSync(victim)
    await overwrite(src, victim)

    const kept = (await trash.list()).filter((e) => e.originalPath === victim)
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ reason: 'replaced', outputPath: victim })
    expect(readFileSync(kept[0].storedPath).equals(victimBytes)).toBe(true)
    expect(existsSync(src)).toBe(true)
  })

  it('keeps one copy, not two, when the file it lands on is its own source', async () => {
    const src = encode('once.mp3')
    await overwrite(src, src)
    expect((await trash.list()).filter((e) => e.originalPath === src)).toHaveLength(1)
  })

  it('keeps nothing when the user turned backups off', async () => {
    const src = encode('incoming-never.mp3')
    const victim = encode('already-there-never.mp3')
    configureOriginalKeeper(
      policyKeeper(
        () => 'never',
        (path, reason, outputPath) => trash.stash(path, reason, outputPath),
      ),
    )
    try {
      await overwrite(src, victim)
    } finally {
      configureOriginalKeeper((path, reason, outputPath) => trash.stash(path, reason, outputPath))
    }
    expect((await trash.list()).filter((e) => e.originalPath === victim)).toEqual([])
  })

  // A re-export lands on the track's own previous output with no prompt: that file is this
  // source's audio, made again in a moment, and keeping one per re-export filled the trash
  // with copies nobody asked for. Only the user's "Overwrite" earns the copy.
  it('keeps nothing when no overwrite was chosen, as when re-exporting over its own output', async () => {
    const src = encode('reexport.mp3')
    const previous = encode('reexport-previous.mp3')
    await convertAudio(src, previous, 'mp3', meta)
    expect((await trash.list()).filter((e) => e.originalPath === previous)).toEqual([])
  })
})

// An in-place export that also renames the file leaves the old path behind; it used to
// be unlinked once the new file was verified in place. Same promise: it goes to the trash.
describe('the original an in-place rename leaves behind', () => {
  it('goes to the trash instead of being unlinked', async () => {
    const src = encode('old-name.mp3')
    const renamed = encode('new-name.mp3')
    await removeRenamedOriginal(src, renamed)
    expect(existsSync(src)).toBe(false)
    const kept = (await trash.list()).find((e) => e.originalPath === src)
    expect(kept).toMatchObject({ reason: 'renamed', outputPath: renamed })
  })
})

// Serato's and Mixed In Key's cue objects sit as GEOB frames in a WAV's ID3 chunk, and the
// update drops them: TagLib cannot write them back without failing the whole save. Until
// they can be kept, a same-format WAV update that loses them is no "tags only" change, so
// the original is kept even when the backups are set to keep only audio changes.
describe('a WAV update that drops foreign cue objects', () => {
  const frame = (id: string, body: Buffer) => {
    const head = Buffer.alloc(10)
    head.write(id, 0, 'latin1')
    head.writeUInt32BE(body.length, 4)
    return Buffer.concat([head, body])
  }
  const id3 = (...frames: Buffer[]) => {
    const body = Buffer.concat(frames)
    const size = Buffer.from([
      (body.length >> 21) & 0x7f,
      (body.length >> 14) & 0x7f,
      (body.length >> 7) & 0x7f,
      body.length & 0x7f,
    ])
    return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0]), size, body])
  }
  const wav = (name: string, withSerato: boolean): string => {
    const out = join(dir, name)
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'pcm_s16le',
      out,
    ])
    if (!withSerato) return out
    const tag = id3(
      frame('TIT2', Buffer.concat([Buffer.from([0]), Buffer.from('Old', 'latin1')])),
      frame(
        'GEOB',
        Buffer.concat([
          Buffer.from([0]),
          Buffer.from('application/octet-stream\0\0Serato Markers2\0', 'latin1'),
          Buffer.alloc(300, 0x41),
        ]),
      ),
    )
    const head = Buffer.alloc(8)
    head.write('id3 ', 0, 'latin1')
    head.writeUInt32LE(tag.length, 4)
    const file = Buffer.concat([readFileSync(out), head, tag, Buffer.alloc(tag.length & 1)])
    file.writeUInt32LE(file.length - 8, 4)
    writeFileSync(out, file)
    return out
  }
  const updated = async (src: string) => {
    configureOriginalKeeper(
      policyKeeper(
        () => 'audioChanges',
        (path, reason, outputPath) => trash.stash(path, reason, outputPath),
      ),
    )
    try {
      await convertAudio(src, src, 'wav', meta)
    } finally {
      configureOriginalKeeper((path, reason, outputPath) => trash.stash(path, reason, outputPath))
    }
    return (await trash.list()).filter((e) => e.originalPath === src)
  }

  it('keeps the original when the update loses Serato markers', async () => {
    expect(await updated(wav('serato.wav', true))).toHaveLength(1)
  })

  it('keeps nothing for a WAV with no such objects, as only its tags change', async () => {
    expect(await updated(wav('plain.wav', false))).toEqual([])
  })
})
