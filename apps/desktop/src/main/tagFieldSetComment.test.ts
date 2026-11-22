import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  Id3v2FrameClassType,
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { emptyMetadata } from '../shared/metadata'
import { heldComment, setTagFields } from './tagFieldSet'
import { snapshotTags } from './tagSnapshot'
import { writeTags } from './tags'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-fieldset-comment-'))
let n = 0

function track(ext: string, comment: string): string {
  const file = join(dir, `c${n++}.${ext}`)
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=d=1',
    ...(ext === 'm4a' ? ['-c:a', 'aac'] : []),
    file,
  ])
  writeTags(file, { ...emptyMetadata(), title: 'T', artist: 'A', comment })
  return file
}

function commentOf(file: string): string {
  const f = TagFile.createFromPath(file)
  try {
    return f.tag.comment ?? ''
  } finally {
    f.dispose()
  }
}

describe('setTagFields — the comment tag', () => {
  it.each(['mp3', 'm4a', 'aiff', 'wav'])(
    'writes the comment of a %s and reads back the new one without touching the rest',
    (ext) => {
      const file = track(ext, 'Remix')
      const before = snapshotTags(file).filter((l) => !/comment|COMM|ICMT|cmt/i.test(l))
      expect(
        setTagFields(file, [{ field: 'comment', from: 'Remix', to: '2 - 8 · Remix' }]),
      ).toEqual(['written'])
      expect(commentOf(file)).toBe('2 - 8 · Remix')
      expect(snapshotTags(file).filter((l) => !/comment|COMM|ICMT|cmt/i.test(l))).toEqual(before)
    },
  )

  it('writes a flac comment to COMMENT and drops DESCRIPTION, the field Surco and rekordbox read', () => {
    const file = join(dir, `c${n++}.flac`)
    execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=1', file])
    const seed = TagFile.createFromPath(file)
    const seedXiph = seed.getTag(TagTypes.Xiph, true) as XiphComment
    seedXiph.setFieldAsStrings('COMMENT', 'Remix')
    seed.save()
    seed.dispose()
    expect(setTagFields(file, [{ field: 'comment', from: 'Remix', to: 'New' }])).toEqual([
      'written',
    ])
    const f = TagFile.createFromPath(file)
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment
    expect(xiph.getField('COMMENT')).toEqual(['New'])
    expect(xiph.getField('DESCRIPTION')).toEqual([])
    f.dispose()
  })

  it('drops the TXXX comment mirror on an mp3 so mp3tag does not list two comments', () => {
    const file = track('mp3', 'Remix')
    const seed = TagFile.createFromPath(file)
    const id3 = seed.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    const mirror = Id3v2UserTextInformationFrame.fromDescription('comment')
    mirror.text = ['Remix']
    id3.addFrame(mirror)
    seed.save()
    seed.dispose()
    expect(setTagFields(file, [{ field: 'comment', from: 'Remix', to: 'New' }])).toEqual([
      'written',
    ])
    const f = TagFile.createFromPath(file)
    const after = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    const users = after.getFramesByClassType<Id3v2UserTextInformationFrame>(
      Id3v2FrameClassType.UserTextInformationFrame,
    )
    expect(users.filter((u) => u.description.toLowerCase() === 'comment')).toEqual([])
    f.dispose()
  })

  it('leaves the file alone when its comment is no longer the one read', () => {
    const file = track('mp3', 'Remix')
    const before = snapshotTags(file)
    expect(setTagFields(file, [{ field: 'comment', from: 'Otro', to: 'New' }])).toEqual([
      'unchanged',
    ])
    expect(snapshotTags(file)).toEqual(before)
    expect(commentOf(file)).toBe('Remix')
  })
})

describe('heldComment', () => {
  it('returns the comment of an mp3 untrimmed, so a comment with trailing spaces can still be matched and rewritten', () => {
    const file = track('mp3', 'Remix  ')
    const held = heldComment(file)
    expect(held).toBe('Remix  ')
    expect(setTagFields(file, [{ field: 'comment', from: held, to: '2 - 8 · Remix  ' }])).toEqual([
      'written',
    ])
  })

  it('returns the comment of a wav untrimmed, whichever tag holds it first', () => {
    expect(heldComment(track('wav', 'Remix  '))).toBe('Remix  ')
  })
})
