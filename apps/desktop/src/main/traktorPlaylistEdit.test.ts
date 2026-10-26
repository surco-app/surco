import { describe, expect, it } from 'vitest'
import type { RekordboxPlaylistEdit } from '../shared/types'
import type { EditOp } from './rekordboxQueueOps'
import { applyTraktorEdits } from './traktorPlaylistEdit'
import { PLAYLISTS_SAMPLE } from './traktorPlaylistFixture'
import { nodeById, parsePlaylists, traktorStamps } from './traktorPlaylistModel'
import { readTraktorPlaylist, readTraktorTree } from './traktorPlaylists'

const track = (file: string, title: string, playtime = '200') =>
  `<ENTRY TITLE="${title}"><LOCATION DIR="/:m/:" FILE="${file}" VOLUME="HD" VOLUMEID="v"></LOCATION><INFO PLAYTIME="${playtime}"></INFO></ENTRY>`

const DOC = PLAYLISTS_SAMPLE.replace(
  '<COLLECTION ENTRIES="0"></COLLECTION>',
  `<COLLECTION ENTRIES="4">\n${[
    track('a.mp3', 'A'),
    track('b.mp3', 'B'),
    track('c.mp3', 'C'),
    track('sep.mp3', '', '1'),
  ].join('\n')}\n</COLLECTION>`,
)

const stampsFor = (doc: string, ...ids: string[]) => {
  const all = traktorStamps(doc)
  return Object.fromEntries(ids.map((id) => [id, all[id]]))
}

let n = 0
const op = (edit: RekordboxPlaylistEdit, ...stampIds: string[]): EditOp => ({
  id: `op${++n}`,
  kind: 'edit',
  edit,
  stamps: stampsFor(DOC, ...stampIds),
  label: 'x',
})

const run = (...ops: EditOp[]) => applyTraktorEdits(DOC, ops, 'HD')
const rows = (doc: string, id: string) =>
  readTraktorPlaylist(doc, id, 'HD').map((e) => (e.separator ? '|' : e.path?.split('/').pop()))
const outsidePlaylists = (doc: string) =>
  doc.slice(0, doc.indexOf('<PLAYLISTS>')) + doc.slice(doc.indexOf('</PLAYLISTS>'))

describe('applyTraktorEdits', () => {
  it('creates a playlist and a folder where the DJ asked, leaving everything else as it was', () => {
    const { nml, outcomes } = run(
      op({ kind: 'create', parentId: 'folder:Sets#2', name: 'Saturday', folder: false }),
      op({ kind: 'create', parentId: 'root', name: 'Gigs & "More" <2026>', folder: true }),
    )
    expect([...outcomes.values()].every((o) => o.applied)).toBe(true)
    const tree = readTraktorTree(nml)
    expect(tree.at(-1)).toMatchObject({ name: 'Gigs & "More" <2026>', kind: 'folder', count: 0 })
    expect(nodeById(parsePlaylists(nml), 'folder:Sets#2')?.children.map((c) => c.name)).toEqual([
      'Old',
      'Saturday',
    ])
    expect(outsidePlaylists(nml)).toBe(outsidePlaylists(DOC))
    for (const tag of ['NODE', 'SUBNODES', 'PLAYLIST', 'ENTRY'])
      expect((nml.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length).toBe(
        (nml.match(new RegExp(`</${tag}>`, 'g')) ?? []).length,
      )
    expect(nml).toContain('<NODE TYPE="FOLDER" NAME="Gigs &amp; &quot;More&quot; &lt;2026&gt;">')
  })

  it('renames and deletes a folder with everything inside it', () => {
    const { nml } = run(
      op({ kind: 'rename', playlistId: 'dnb', name: 'DnB' }),
      op({ kind: 'delete', playlistId: 'folder:Sets' }),
    )
    expect(readTraktorTree(nml).map((n) => n.name)).toEqual(['Preparation', 'Sets', 'DnB'])
  })

  it('adds tracks by their Traktor key or their file, reporting the ones already there and the ones Traktor lacks', () => {
    const { nml, outcomes } = run(
      op({
        kind: 'add',
        playlistId: 'fri',
        tracks: [
          { contentId: 'traktor:HD/:m/:b.mp3', paths: [] },
          { paths: ['/m/c.mp3'] },
          { paths: ['/m/a.mp3'] },
          { paths: ['/elsewhere/z.mp3'] },
        ],
      }),
    )
    expect(rows(nml, 'fri')).toEqual(['a.mp3', '|', 'a.mp3', 'b.mp3', 'c.mp3'])
    expect([...outcomes.values()][0]).toMatchObject({
      applied: true,
      report: { added: 2, already: 1, notInCollection: 1, ambiguous: 0 },
    })
    expect(nml).toContain('ENTRIES="5" TYPE="LIST" UUID="fri"')
  })

  it('says there is nothing to add when every track is already in the playlist', () => {
    const { nml, outcomes } = run(
      op({ kind: 'add', playlistId: 'fri', tracks: [{ paths: ['/m/a.mp3'] }] }),
    )
    expect([...outcomes.values()][0]).toMatchObject({ applied: false, reason: 'nothing-to-add' })
    expect(nml).toBe(DOC)
  })

  it('applies a move and then a remove queued on the same playlist to the rows the DJ saw', () => {
    const { nml } = run(
      op(
        {
          kind: 'move',
          playlistId: 'fri',
          linkIds: ['fri:2:HD/:m/:a.mp3'],
          beforeLinkId: 'fri:0:HD/:m/:a.mp3',
        },
        'fri',
      ),
      op({ kind: 'remove', playlistId: 'fri', linkIds: ['fri:1:HD/:m/:sep.mp3'] }, 'fri'),
    )
    expect(rows(nml, 'fri')).toEqual(['a.mp3', 'a.mp3'])
  })

  it('inserts the DJ separator before a row', () => {
    const { nml } = run(
      op({ kind: 'insertSeparator', playlistId: 'fri', beforeLinkId: 'fri:2:HD/:m/:a.mp3' }),
    )
    expect(rows(nml, 'fri')).toEqual(['a.mp3', '|', '|', 'a.mp3'])
  })

  it('refuses an edit on a playlist the DJ changed in Traktor since, and writes nothing', () => {
    const queued = op({ kind: 'remove', playlistId: 'fri', linkIds: ['fri:0:HD/:m/:a.mp3'] }, 'fri')
    const changed = DOC.replace(
      '<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="HD/:m/:sep.mp3"></PRIMARYKEY>\n</ENTRY>\n',
      '',
    )
    const { nml, outcomes } = applyTraktorEdits(changed, [queued], 'HD')
    expect(nml).toBe(changed)
    expect(outcomes.get(queued.id)).toMatchObject({
      applied: false,
      reason: 'stale',
      notices: [{ code: 'edit-changed', playlist: 'Friday' }],
    })
  })

  it('never renames or deletes Traktor’s own playlists, nor edits its history', () => {
    const history = DOC.replace('NAME="Drum &amp; Bass"', 'NAME="HISTORY"')
    const { nml, outcomes } = applyTraktorEdits(
      history,
      [
        op({ kind: 'rename', playlistId: 'prep', name: 'Mine' }),
        op({ kind: 'delete', playlistId: 'prep' }),
        op({ kind: 'add', playlistId: 'dnb', tracks: [{ paths: ['/m/b.mp3'] }] }),
      ],
      'HD',
    )
    expect(nml).toBe(history)
    expect([...outcomes.values()].map((o) => o.reason)).toEqual(['stale', 'stale', 'stale'])
  })

  it('still adds tracks to Preparation, where a DJ lines up the next set', () => {
    const { outcomes } = run(
      op({ kind: 'add', playlistId: 'prep', tracks: [{ paths: ['/m/b.mp3'] }] }),
    )
    expect([...outcomes.values()][0]).toMatchObject({ applied: true })
  })

  it('refuses an empty name and an id that is gone', () => {
    const { outcomes } = run(
      op({ kind: 'create', parentId: 'root', name: '  ', folder: false }),
      op({ kind: 'rename', playlistId: 'nope', name: 'X' }),
    )
    expect([...outcomes.values()].map((o) => o.reason)).toEqual(['stale', 'stale'])
  })

  it('writes the rows it adds with the collection’s own line endings', () => {
    const crlf = DOC.replace(/\n/g, '\r\n')
    const { nml } = applyTraktorEdits(
      crlf,
      [op({ kind: 'add', playlistId: 'dnb', tracks: [{ paths: ['/m/b.mp3'] }] })],
      'HD',
    )
    expect(nml).not.toBe(crlf)
    expect(nml.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('refuses a row edit when that place no longer holds the track the DJ saw there', () => {
    const { nml, outcomes } = run(
      op({ kind: 'remove', playlistId: 'fri', linkIds: ['fri:1:HD/:m/:a.mp3'] }),
    )
    expect(nml).toBe(DOC)
    expect([...outcomes.values()][0]).toMatchObject({ applied: false, reason: 'stale' })
  })
})
