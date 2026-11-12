import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readSeratoTrack } from '../../main/seratoTags'
import { buildSeratoCrate, concat, frame, textFrame } from '../../shared/serato'
import type { TestLibrary } from './testLibrary'

export const seratoLibrary: TestLibrary = {
  build: ({ home }, tracks, listName) => {
    const dir = join(home, 'Music', '_Serato_')
    mkdirSync(join(dir, 'Subcrates'), { recursive: true })
    writeFileSync(
      join(dir, 'database V2'),
      concat([
        textFrame('vrsn', '2.0/Serato Scratch LIVE Database'),
        ...tracks.map((t) =>
          frame(
            'otrk',
            concat([
              textFrame('pfil', t.path.slice(1)),
              textFrame('tsng', t.title),
              textFrame('tart', t.artist),
            ]),
          ),
        ),
      ]),
    )
    writeFileSync(
      join(dir, 'Subcrates', `${listName}.crate`),
      buildSeratoCrate(tracks.map((t) => ({ inputPath: t.path }))),
    )
    return { syncSerato: true, addToSerato: true }
  },
  formatProblems: () => [],
  storedCuesMs: (_settings, path) => (readSeratoTrack(path)?.markers?.cues ?? []).map((c) => c.ms),
}
