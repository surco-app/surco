import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { emptyMetadata } from '../shared/metadata'
import { setTagFields } from './tagFieldSet'
import { snapshotTags } from './tagSnapshot'
import { writeTags } from './tags'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-fieldset-genre-'))
const BEATPORT = 'Techno (Peak Time / Driving)'

// Beatport genres carry parentheses, and TagLib writes every '(' of a v2.3 genre as '(('.
// The review's one-field edits save the whole tag, so the genre has to come through them
// as written, whether the edit was the genre or another field.
describe('setTagFields — a genre with parentheses on ID3 targets', () => {
  it.each(['mp3', 'aiff', 'wav'])('a %s keeps it through a title edit', (ext) => {
    const file = join(dir, `title.${ext}`)
    execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=1', file])
    writeTags(file, { ...emptyMetadata(), title: 'Old', genre: BEATPORT })
    expect(setTagFields(file, [{ field: 'title', from: 'Old', to: 'New' }])).toEqual(['written'])
    expect(snapshotTags(file).filter((l) => l.startsWith('id3 TCON'))).toEqual([
      `id3 TCON=${BEATPORT}`,
    ])
  })

  it.each(['mp3', 'aiff', 'wav'])('a %s takes it as written from a genre edit', (ext) => {
    const file = join(dir, `genre.${ext}`)
    execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=1', file])
    writeTags(file, { ...emptyMetadata(), title: 'T', genre: 'Trance' })
    expect(setTagFields(file, [{ field: 'genre', from: 'Trance', to: BEATPORT }])).toEqual([
      'written',
    ])
    expect(snapshotTags(file).filter((l) => l.startsWith('id3 TCON'))).toEqual([
      `id3 TCON=${BEATPORT}`,
    ])
  })
})
