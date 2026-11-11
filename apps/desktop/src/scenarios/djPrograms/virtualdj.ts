import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseVirtualdjDatabase } from '../../main/virtualdjDatabase'
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
  formatProblems: ({ virtualdjLibraryDir }) => {
    const dir = virtualdjLibraryDir ?? ''
    const lists = join(dir, 'MyLists')
    const crlfFiles = [
      join(dir, 'database.xml'),
      ...readdirSync(lists, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.vdjfolder'))
        .map((name) => join(lists, name)),
    ]
    const orders = readdirSync(lists, { recursive: true, encoding: 'utf8' })
      .filter((name) => basename(name) === 'order')
      .map((name) => join(lists, name))
    return [
      ...crlfFiles
        .filter((file) => /(^|[^\r])\n/.test(readFileSync(file, 'utf8')))
        .map((file) => `${file} has a bare LF`),
      ...orders
        .filter((file) => readFileSync(file, 'utf8').includes('\r'))
        .map((file) => `${file} has a CR`),
    ]
  },
  storedCuesMs: ({ virtualdjLibraryDir }, path) =>
    (
      parseVirtualdjDatabase(
        readFileSync(join(virtualdjLibraryDir ?? '', 'database.xml'), 'utf8'),
      ).find((song) => song.path === path)?.pois ?? []
    )
      .filter((poi) => poi.kind === 'cue' && poi.num !== null && poi.num >= 1 && poi.num <= 8)
      .map((poi) => poi.seconds * 1000),
}
