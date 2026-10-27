import { describe, expect, it } from 'vitest'
import {
  collectionsTraktorUses,
  collectionTraktorUses,
  detectTraktorNmlPaths,
  sameCollection,
  traktorRootDir,
} from './traktorNmlPath'

describe('detectTraktorNmlPaths', () => {
  // Traktor crea una carpeta por versión y la ruta cambia al actualizar. Se propone
  // la más nueva, pero se devuelven todas: el usuario puede tener varias y saber
  // cuál usa de verdad.
  it('proposes the newest Traktor version first', () => {
    const dirs = ['Traktor 4.4.1', 'Traktor 4.5.0', 'Traktor 4.4.2']

    const found = detectTraktorNmlPaths('/Users/dj', () => dirs)

    expect(found[0]).toContain('Traktor 4.5.0')
    expect(found).toHaveLength(3)
  })

  // Comparación por número, no alfabética: "4.10" es posterior a "4.9" aunque
  // ordene antes como texto.
  it('orders versions numerically, not lexically', () => {
    const found = detectTraktorNmlPaths('/Users/dj', () => ['Traktor 4.9.0', 'Traktor 4.10.0'])

    expect(found[0]).toContain('Traktor 4.10.0')
  })

  // Sin Traktor instalado no hay nada que proponer, y no es un error: el usuario
  // elegirá su .nml a mano si lo tiene fuera del sitio estándar.
  it('finds nothing when there is no Traktor folder', () => {
    expect(detectTraktorNmlPaths('/Users/dj', () => [])).toEqual([])
  })
})

const tsi = (root: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<NIXML><TraktorSettings><Entry Name="Browser.Dir.Loops" Type="3" Value="Macintosh HD:Users:dj:Music:Traktor:Samples:"></Entry>\n<Entry Name="Browser.Dir.Root" Type="3" Value="${root}"></Entry>\n</TraktorSettings></NIXML>`

describe('traktorRootDir', () => {
  // Traktor reads and saves its collection in the Root Dir of its settings, whatever its
  // version: a Traktor 4.4.0 can keep using the folder of 4.0.2. Shape taken from a real
  // Traktor 3.4.0 settings file.
  it('reads the Root Dir Traktor keeps on a Mac, with the boot disk named first', () => {
    expect(
      traktorRootDir(
        tsi('Macintosh HD:Users:andyfischer:Documents:Native Instruments:Traktor 3.4.0:'),
        'Macintosh HD',
      ),
    ).toBe('/Users/andyfischer/Documents/Native Instruments/Traktor 3.4.0')
  })

  it('places a Root Dir on another disk under /Volumes', () => {
    expect(traktorRootDir(tsi('Music SSD:Traktor:'), 'Macintosh HD')).toBe(
      '/Volumes/Music SSD/Traktor',
    )
  })

  it('reads a Windows Root Dir as written', () => {
    expect(
      traktorRootDir(tsi('C:\\Users\\Usuario\\Documents\\Native Instruments\\Traktor 4.0.2\\'), ''),
    ).toBe('C:\\Users\\Usuario\\Documents\\Native Instruments\\Traktor 4.0.2')
  })

  // Shape taken from a real Windows settings file (Traktor 3.11.1): written as is, no
  // trailing separator.
  it('reads a Windows Root Dir saved without a trailing separator', () => {
    expect(
      traktorRootDir(tsi('C:\\Users\\djotas\\Documents\\Native Instruments\\Traktor 3.11.1'), ''),
    ).toBe('C:\\Users\\djotas\\Documents\\Native Instruments\\Traktor 3.11.1')
  })

  it('decodes the characters XML escapes', () => {
    expect(traktorRootDir(tsi('Macintosh HD:Users:dj:Drum &amp; Bass:'), 'Macintosh HD')).toBe(
      '/Users/dj/Drum & Bass',
    )
  })

  it('says nothing when the settings carry no Root Dir', () => {
    expect(
      traktorRootDir('<NIXML><TraktorSettings></TraktorSettings></NIXML>', 'Macintosh HD'),
    ).toBeNull()
  })
})

describe('collectionTraktorUses', () => {
  const same = (a: string, b: string) => a === b
  const nml402 = 'C:/NI/Traktor 4.0.2/collection.nml'
  const nml440 = 'C:/NI/Traktor 4.4.0/collection.nml'

  // The case behind it: Surco wrote into Traktor 4.4.0, the version installed, while that
  // Traktor kept its Root Dir in 4.0.2 and never saw a single save.
  it('names the collection Traktor uses when no Traktor uses the chosen one', () => {
    expect(collectionTraktorUses(nml440, [nml402, nml402], same)).toBe(nml402)
  })

  it('stays quiet when some Traktor uses the chosen collection', () => {
    expect(collectionTraktorUses(nml402, [nml440, nml402], same)).toBeNull()
  })

  it('stays quiet when no Traktor settings could be read', () => {
    expect(collectionTraktorUses(nml440, [], same)).toBeNull()
  })

  it('proposes the collection of the newest Traktor first', () => {
    expect(collectionTraktorUses('/elsewhere/collection.nml', [nml402, nml440], same)).toBe(nml402)
  })
})

describe('collectionsTraktorUses', () => {
  const ni = '/Users/dj/Documents/Native Instruments'
  const files: Record<string, string> = {
    [`${ni}/Traktor 4.4.0/Traktor Settings.tsi`]: tsi(
      'Macintosh HD:Users:dj:Documents:Native Instruments:Traktor 4.0.2:',
    ),
    [`${ni}/Traktor 4.0.2/Traktor Settings.tsi`]: tsi(
      'Macintosh HD:Users:dj:Documents:Native Instruments:Traktor 4.0.2:',
    ),
    [`${ni}/Traktor 3.4.0/Traktor Settings.tsi`]: tsi('Macintosh HD:Users:dj:Gone:'),
    [`${ni}/Traktor 4.0.2/collection.nml`]: '<NML/>',
  }
  const read = (path: string) => files[path] ?? null
  const exists = (path: string) => path in files

  // Each version folder keeps the settings of its Traktor; the collection each one uses is
  // the collection.nml in its Root Dir, listed once, newest Traktor first, and only if it
  // is there.
  it('lists the collection every Traktor keeps in its Root Dir, once and only if present', () => {
    expect(
      collectionsTraktorUses(
        [
          `${ni}/Traktor 4.4.0/collection.nml`,
          `${ni}/Traktor 4.0.2/collection.nml`,
          `${ni}/Traktor 3.4.0/collection.nml`,
        ],
        read,
        exists,
        'Macintosh HD',
      ),
    ).toEqual([`${ni}/Traktor 4.0.2/collection.nml`])
  })
})

describe('sameCollection', () => {
  // When the boot disk name cannot be read, a Root Dir comes back under /Volumes/<disk>,
  // which macOS links to /: the same folder, and no reason to warn the DJ.
  it('treats two paths to the same file as one collection', () => {
    const real = (p: string) => p.replace('/Volumes/Mac_Os_Tahoe', '')
    expect(
      sameCollection(
        '/Volumes/Mac_Os_Tahoe/Users/djotas/Documents/Native Instruments/Traktor 4.5.1/collection.nml',
        '/Users/djotas/Documents/Native Instruments/Traktor 4.5.1/collection.nml',
        real,
        'darwin',
      ),
    ).toBe(true)
  })

  it('keeps two different collections apart', () => {
    expect(sameCollection('/a/collection.nml', '/b/collection.nml', (p) => p, 'darwin')).toBe(false)
  })

  // Windows does not tell capitals apart: C:\Users and c:\users are one folder.
  it('ignores capitals on Windows', () => {
    expect(
      sameCollection('C:/Users/X/collection.nml', 'c:/users/x/collection.nml', (p) => p, 'win32'),
    ).toBe(true)
  })

  it('compares the paths as written when the file cannot be resolved', () => {
    const missing = () => {
      throw new Error('ENOENT')
    }
    expect(sameCollection('/a/collection.nml', '/a/collection.nml', missing, 'darwin')).toBe(true)
  })
})
