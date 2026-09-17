import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { assertDecodable } from './ffmpeg'
import { diffSnapshots, snapshotTags } from './tagSnapshot'
import {
  ALLOWED_UPDATE_CHANGES,
  unexplainedChanges,
  updateExtOf,
  updateLikeTheApp,
} from './updateContract'

// The synthetic matrix cannot carry what twenty years of DJ files carry: a Lyrics3 block
// after the last frame, Traktor's padded PRIV, an ID3 tag in front of a FLAC, a WAV with
// both INFO and id3 chunks. Every file a user sends with a report goes into a folder
// outside the repo (they are copyrighted music), and this runs the update contract over
// each one: the conversion check accepts it, a first pass changes only what the contract
// allows, a second pass changes nothing. Skipped without the folder, so CI never needs it.
//
//   SURCO_TAG_CORPUS_DIR=~/code/surco-corpus/tags npm run corpus
const root = process.env.SURCO_TAG_CORPUS_DIR
const dir = mkdtempSync(join(tmpdir(), 'surco-tag-corpus-'))

const files = root
  ? readdirSync(root)
      .filter((n) => !n.startsWith('.') && updateExtOf(n) !== null)
      .sort()
      .map((n) => join(root, n))
  : []

describe.skipIf(!root)('the real-file corpus', () => {
  it('has files to run over', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  describe.each(files.map((f) => [basename(f), f]))('%s', (name, file) => {
    // biome-ignore lint/style/noNonNullAssertion: filtered above
    const ext = updateExtOf(file)!
    const pass1 = join(dir, `${name}.pass1.${ext}`)
    const pass2 = join(dir, `${name}.pass2.${ext}`)
    let before: string[]
    let after1: string[]
    let after2: string[]

    it('passes the conversion check as it is', async () => {
      await expect(assertDecodable(file)).resolves.toBeUndefined()
    }, 120000)

    it('updates twice', async () => {
      await updateLikeTheApp(file, pass1, ext)
      await updateLikeTheApp(pass1, pass2, ext)
      before = snapshotTags(file)
      after1 = snapshotTags(pass1)
      after2 = snapshotTags(pass2)
    }, 300000)

    it('changes nothing it was not meant to on the first pass', () => {
      const { added, removed } = diffSnapshots(before, after1)
      const rules = ALLOWED_UPDATE_CHANGES[ext]
      expect(unexplainedChanges(added, rules.added), 'fields the update invented').toEqual([])
      expect(unexplainedChanges(removed, rules.removed), 'fields the update lost').toEqual([])
    })

    it('lands on the same tags and picture when run a second time', () => {
      expect(diffSnapshots(after1, after2)).toEqual({ added: [], removed: [] })
    })
  })
})
