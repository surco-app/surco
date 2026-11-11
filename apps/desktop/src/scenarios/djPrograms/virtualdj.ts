import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TestLibrary } from './testLibrary'

const attr = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const crlf = (lines: string[]): string => `${lines.join('\r\n')}\r\n`

export const virtualdjLibrary: TestLibrary = {
  build: ({ root }, tracks, listName) => {
    const dir = join(root, 'VirtualDJ')
    mkdirSync(join(dir, 'MyLists'), { recursive: true })
    writeFileSync(
      join(dir, 'database.xml'),
      crlf([
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<VirtualDJ_Database Version="2026">',
        ...tracks.flatMap((t) => [
          ` <Song FilePath="${attr(t.path)}" FileSize="${statSync(t.path).size}">`,
          `  <Tags Author="${attr(t.artist)}" Title="${attr(t.title)}" />`,
          `  <Infos SongLength="${t.durationSec.toFixed(6)}" />`,
          '  <Scan Version="801" Bpm="0.500000" Phase="0.000000" />',
          ' </Song>',
        ]),
        '</VirtualDJ_Database>',
      ]),
    )
    writeFileSync(
      join(dir, 'MyLists', `${listName}.vdjfolder`),
      crlf([
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<VirtualFolder noDuplicates="no">',
        ...tracks.map(
          (t, i) => `\t<song path="${attr(t.path)}" size="${statSync(t.path).size}" idx="${i}" />`,
        ),
        '</VirtualFolder>',
      ]),
    )
    writeFileSync(join(dir, 'MyLists', 'order'), `${listName}\n`)
    return { syncVirtualdj: true, addToVirtualdj: true, virtualdjLibraryDir: dir }
  },
}
