import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readVirtualdjLists } from './virtualdjLists'

const fixture = join(__dirname, 'virtualdjFixtures', 'MyLists')
const made: string[] = []

function temp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vdj-lists-'))
  made.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  return dir
}

const songs = (...paths: string[]) =>
  `<VirtualFolder>\r\n${paths.map((p, i) => `<song path="${p}" idx="${i}" />`).join('\r\n')}\r\n</VirtualFolder>`

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('readVirtualdjLists', () => {
  it('lists the panel in the order VirtualDJ shows it, folders and lists alike', () => {
    expect(readVirtualdjLists(fixture).map((n) => n.name)).toEqual([
      'Carpeta',
      'Surco prueba',
      'Surco escrita',
    ])
  })

  it('tells a folder from an empty list by its .subfolders directory and reads the nested one', () => {
    const [carpeta] = readVirtualdjLists(fixture)
    expect(carpeta).toMatchObject({ id: 'Carpeta', kind: 'folder', paths: [] })
    expect(carpeta.children).toEqual([
      {
        id: 'Carpeta/Dentro',
        name: 'Dentro',
        kind: 'playlist',
        paths: ['/Music/Serato Pruebas/Pray.mp3'],
      },
    ])
  })

  it('reads a list written by VirtualDJ with all its paths', () => {
    const prueba = readVirtualdjLists(fixture)[1]
    expect(prueba.kind).toBe('playlist')
    expect(prueba.paths).toHaveLength(5)
    expect(prueba.paths[2]).toBe('/Music/VirtualDJ Pruebas/Pray.aiff')
  })

  it('reads a list Surco wrote by hand with CRLF', () => {
    const escrita = readVirtualdjLists(fixture)[2]
    expect(escrita.paths).toHaveLength(1)
  })

  it('keeps the idx order so the list plays as the user arranged it', () => {
    const dir = temp({
      'A.vdjfolder':
        '<VirtualFolder>\n<song path="/b.mp3" idx="1" />\n<song path="/a.mp3" idx="0" />\n</VirtualFolder>',
    })
    expect(readVirtualdjLists(dir)[0].paths).toEqual(['/a.mp3', '/b.mp3'])
  })

  it('falls back to file order when songs carry no idx', () => {
    const dir = temp({
      'A.vdjfolder':
        '<VirtualFolder>\n<song path="/z.mp3" />\n<song path="/a.mp3" />\n</VirtualFolder>',
    })
    expect(readVirtualdjLists(dir)[0].paths).toEqual(['/z.mp3', '/a.mp3'])
  })

  it('decodes XML entities so the path matches the file on disk', () => {
    const dir = temp({ 'A.vdjfolder': songs('/Music/Rock &amp; Roll.mp3') })
    expect(readVirtualdjLists(dir)[0].paths).toEqual(['/Music/Rock & Roll.mp3'])
  })

  it('puts lists missing from order at the end sorted by name and skips names without a file', () => {
    const dir = temp({
      order: 'Ghost\nB\n',
      'B.vdjfolder': songs('/b.mp3'),
      'Z.vdjfolder': songs('/z.mp3'),
      'A.vdjfolder': songs('/a.mp3'),
    })
    expect(readVirtualdjLists(dir).map((n) => n.name)).toEqual(['B', 'A', 'Z'])
  })

  it('sorts by name when there is no order file at all', () => {
    const dir = temp({ 'B.vdjfolder': songs('/b.mp3'), 'A.vdjfolder': songs('/a.mp3') })
    expect(readVirtualdjLists(dir).map((n) => n.name)).toEqual(['A', 'B'])
  })

  it('applies each level its own order', () => {
    const dir = temp({
      'F.vdjfolder': '<VirtualFolder />',
      'F.subfolders/order': 'Two\nOne\n',
      'F.subfolders/One.vdjfolder': songs('/1.mp3'),
      'F.subfolders/Two.vdjfolder': songs('/2.mp3'),
    })
    expect(readVirtualdjLists(dir)[0].children?.map((n) => n.id)).toEqual(['F/Two', 'F/One'])
  })

  it('treats an empty .subfolders directory as an empty folder, not a list', () => {
    const dir = temp({ 'F.vdjfolder': '<VirtualFolder />' })
    mkdirSync(join(dir, 'F.subfolders'))
    expect(readVirtualdjLists(dir)).toEqual([
      { id: 'F', name: 'F', kind: 'folder', paths: [], children: [] },
    ])
  })

  it('treats a .vdjfolder with no songs and no .subfolders as an empty list', () => {
    const dir = temp({ 'E.vdjfolder': '<VirtualFolder />' })
    expect(readVirtualdjLists(dir)).toEqual([{ id: 'E', name: 'E', kind: 'playlist', paths: [] }])
  })

  it('returns an unreadable node empty and still reads its siblings', () => {
    const dir = temp({ 'Bad.vdjfolder': '\u0000<<<not xml', 'Good.vdjfolder': songs('/g.mp3') })
    mkdirSync(join(dir, 'Dir.vdjfolder'))
    expect(readVirtualdjLists(dir).map((n) => [n.name, n.paths])).toEqual([
      ['Bad', []],
      ['Dir', []],
      ['Good', ['/g.mp3']],
    ])
  })

  it('returns nothing when the MyLists directory does not exist', () => {
    expect(readVirtualdjLists(join(fixture, 'nope'))).toEqual([])
  })
})
