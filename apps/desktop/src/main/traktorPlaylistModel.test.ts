import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLAYLISTS_SAMPLE, playlistRow } from './traktorPlaylistFixture'
import {
  nodeById,
  parsePlaylists,
  rowLinkId,
  serializePlaylists,
  stampOf,
  traktorStamps,
} from './traktorPlaylistModel'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')

describe('parsePlaylists', () => {
  it('serializes an untouched tree back byte for byte, here and on real collections', () => {
    for (const nml of [
      PLAYLISTS_SAMPLE,
      fixture('traktor-shared-cover-ids.nml'),
      fixture('traktor-pro-4-collection.nml'),
    ]) {
      const model = parsePlaylists(nml)
      expect(serializePlaylists(nml, model)).toBe(nml)
    }
  })

  it('names twin folders apart, so an edit on the second never lands on the first', () => {
    const model = parsePlaylists(PLAYLISTS_SAMPLE)
    expect(nodeById(model, 'folder:Sets')?.children.map((c) => c.name)).toEqual(['Friday', 'Top'])
    expect(nodeById(model, 'folder:Sets#2')?.children.map((c) => c.name)).toEqual(['Old'])
    expect(nodeById(model, 'folder:Sets#2/Old')?.kind).toBe('folder')
  })

  it('finds playlists by UUID, the root by its own name, and reads escaped names', () => {
    const model = parsePlaylists(PLAYLISTS_SAMPLE)
    expect(nodeById(model, 'fri')?.rows.map((r) => r.key)).toEqual([
      'HD/:m/:a.mp3',
      'HD/:m/:sep.mp3',
      'HD/:m/:a.mp3',
    ])
    expect(nodeById(model, 'root')?.children).toHaveLength(4)
    expect(nodeById(model, 'dnb')?.name).toBe('Drum & Bass')
    expect(nodeById(model, 'nope')).toBeNull()
  })

  it('names each row by its playlist, place and track, the link the list and its edits use', () => {
    const fri = nodeById(parsePlaylists(PLAYLISTS_SAMPLE), 'fri')
    expect(fri && rowLinkId(fri, 2)).toBe('fri:2:HD/:m/:a.mp3')
  })

  it('stamps a playlist by its rows and a folder by its children, so a change in Traktor shows', () => {
    const before = traktorStamps(PLAYLISTS_SAMPLE)
    const reordered = PLAYLISTS_SAMPLE.replace(
      `${playlistRow('HD/:m/:a.mp3')}\n${playlistRow('HD/:m/:sep.mp3')}`,
      `${playlistRow('HD/:m/:sep.mp3')}\n${playlistRow('HD/:m/:a.mp3')}`,
    )
    const after = traktorStamps(reordered)
    expect(after.fri).not.toBe(before.fri)
    expect(after.dnb).toBe(before.dnb)
    const renamedChild = PLAYLISTS_SAMPLE.replace('NAME="Old"', 'NAME="Older"')
    expect(traktorStamps(renamedChild)['folder:Sets#2']).not.toBe(before['folder:Sets#2'])
    const model = parsePlaylists(PLAYLISTS_SAMPLE)
    const fri = nodeById(model, 'fri')
    expect(fri && stampOf(fri)).toBe(before.fri)
  })

  it('rewrites only the nodes an edit touched, keeping the rest of the file as it was', () => {
    const model = parsePlaylists(PLAYLISTS_SAMPLE)
    const dnb = nodeById(model, 'dnb')
    if (!dnb) throw new Error('no dnb')
    dnb.rows.push({ key: 'HD/:m/:b.mp3', text: playlistRow('HD/:m/:b.mp3') })
    dnb.dirty = true
    const sets = nodeById(model, 'folder:Sets')?.text ?? 'missing'
    const out = serializePlaylists(PLAYLISTS_SAMPLE, model)
    expect(out).toContain(sets)
    expect(out).toContain(`UUID="dnb">${playlistRow('HD/:m/:b.mp3')}`)
    expect(out).toContain('ENTRIES="1" TYPE="LIST" UUID="dnb"')
    expect(out.slice(0, out.indexOf('<PLAYLISTS>'))).toBe(
      PLAYLISTS_SAMPLE.slice(0, PLAYLISTS_SAMPLE.indexOf('<PLAYLISTS>')),
    )
    expect(out).toContain('<NODE TYPE="FOLDER" NAME="Sets"><SUBNODES COUNT="2">')
    expect(out.endsWith('</PLAYLISTS>\n<INDEXING></INDEXING>\n</NML>\n')).toBe(true)
  })

  it('reads a collection with no playlists as no model', () => {
    expect(parsePlaylists('<NML><COLLECTION></COLLECTION></NML>')).toBeNull()
  })

  it('gives up on a tree it cannot follow instead of reading forever or swallowing a neighbour', () => {
    const playlists = (body: string) =>
      `<NML><COLLECTION></COLLECTION><PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="2">${body}</SUBNODES></NODE></PLAYLISTS></NML>`
    const broken = [
      PLAYLISTS_SAMPLE.slice(
        0,
        PLAYLISTS_SAMPLE.indexOf('<NODE TYPE="PLAYLIST" NAME="Friday">') + 60,
      ),
      PLAYLISTS_SAMPLE.slice(0, PLAYLISTS_SAMPLE.indexOf('<PRIMARYKEY') + 20),
      playlists('<NODE TYPE="FOLDER" NAME="x"></NODE>'),
      playlists(
        '<NODE TYPE="PLAYLIST" NAME="a>b"><PLAYLIST ENTRIES="0" TYPE="LIST" UUID="u"></PLAYLIST></NODE>',
      ),
      playlists(
        '<NODE TYPE="PLAYLIST" NAME="Odd"></NODE><NODE TYPE="PLAYLIST" NAME="B"><PLAYLIST ENTRIES="0" TYPE="LIST" UUID="b"></PLAYLIST></NODE>',
      ),
    ]
    for (const nml of broken) expect(parsePlaylists(nml)).toBeNull()
  })

  it('keeps Windows line endings in the nodes it rewrites', () => {
    const crlf = PLAYLISTS_SAMPLE.replace(/\n/g, '\r\n')
    const model = parsePlaylists(crlf)
    const dnb = nodeById(model, 'dnb')
    if (!dnb) throw new Error('no dnb')
    dnb.rows.push({ key: 'k', text: 'X' })
    dnb.dirty = true
    expect(serializePlaylists(crlf, model).replace(/\r\n/g, '')).not.toContain('\n')
  })
})
