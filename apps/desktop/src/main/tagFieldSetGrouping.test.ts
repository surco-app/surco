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
const dir = mkdtempSync(join(tmpdir(), 'surco-fieldset-grouping-'))

// The review's one-field edits (title, artist, album artist, album, genre) never write a
// grouping, so the grouping writeTags put down has to come through them as it was: TIT1,
// and GRP1 where one was written, with no TXXX mirror reappearing.
describe('setTagFields — the grouping on ID3 targets', () => {
  it.each([
    ['mp3', ['id3 GRP1=Wärm Up', 'id3 TIT1=Wärm Up']],
    ['aiff', ['id3 GRP1=Wärm Up', 'id3 TIT1=Wärm Up']],
    ['wav', ['id3 TIT1=Wärm Up']],
  ])('a %s keeps its grouping frames through a title edit', (ext, frames) => {
    const file = join(dir, `g.${ext}`)
    execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=1', file])
    writeTags(file, { ...emptyMetadata(), title: 'Old', grouping: 'Wärm Up' })
    expect(setTagFields(file, [{ field: 'title', from: 'Old', to: 'New' }])).toEqual(['written'])
    const lines = snapshotTags(file)
    expect(lines).toContain('id3 TIT2=New')
    expect(lines.filter((l) => /TIT1|GRP1|grouping/i.test(l))).toEqual(frames)
  })
})
