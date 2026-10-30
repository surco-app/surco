// @vitest-environment node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import log from 'electron-log/main'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('./traktorProcess', () => ({ isTraktorRunning: vi.fn().mockResolvedValue(false) }))

// Only `rename`/`copyFile` are faked, and only for the tests that need one
// of them to fail in isolation: every other test relies on the real read/copy/write/
// unlink behaviour on the temp dir it creates. A read-only directory would fail
// multiple calls at once, which can't tell "the backup guard stopped the write" apart
// from "the write failed on its own too" — faking exactly one call is what isolates
// the guard.
const { renameShouldFail, copyFileShouldFail } = vi.hoisted(() => ({
  renameShouldFail: { value: false },
  copyFileShouldFail: { value: false },
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const rename: typeof real.rename = (async (...args: Parameters<typeof real.rename>) => {
    if (renameShouldFail.value && String(args[1]).endsWith('.nml'))
      throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })
    return real.rename(...args)
  }) as typeof real.rename
  const copyFile: typeof real.copyFile = (async (...args: Parameters<typeof real.copyFile>) => {
    if (copyFileShouldFail.value) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    return real.copyFile(...args)
  }) as typeof real.copyFile
  return { ...real, rename, copyFile }
})

// The converted files these patches name don't exist on disk — the collection write is
// what's under test, not TagLib — so the cover read is stubbed to a fixed image, and
// nativeImage (Electron's, unavailable here) to a rasteriser that records its size.
vi.mock('./tags', () => ({ readEmbeddedCover: () => Buffer.from('art') }))
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: () => ({
      isEmpty: () => false,
      resize: ({ width }: { width: number }) => ({
        isEmpty: () => false,
        toPNG: () => Buffer.from(`png:${width}`),
      }),
    }),
  },
}))

import { backupOf } from './libraryBackups'
import { copyFolder, listCopies } from './libraryHistory'
import { createSessionBackup, type SessionBackup } from './rekordboxSessionBackup'
import { bootVolumeName, replaceDuplicatesInCollection, syncCollection } from './traktorNmlLibrary'
import { isTraktorRunning } from './traktorProcess'

const NML = `<NML VERSION="19"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Uno"><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION></ENTRY>
</COLLECTION></NML>`

let dir: string
let nmlPath: string
let session: SessionBackup

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'surco-nml-'))
  nmlPath = join(dir, 'collection.nml')
  writeFileSync(nmlPath, NML)
  session = createSessionBackup({})
  // mockReset (not just a fresh mockResolvedValue) clears any mockResolvedValueOnce
  // left queued by the race test — without it, that queued value leaks into whichever
  // test happens to run next and fails it with the wrong reason.
  vi.mocked(isTraktorRunning).mockReset().mockResolvedValue(false)
  renameShouldFail.value = false
  copyFileShouldFail.value = false
})

const patch = { volume: 'HD', dir: '/:M/:', file: 'uno.aiff', newFile: 'uno.flac' }

describe('syncCollection on the boot disk', () => {
  it('matches a track Traktor stores under the boot volume name, which a boot-disk path leaves empty', async () => {
    writeFileSync(
      nmlPath,
      NML.replace('DIR="/:M/:"', 'DIR="/:Users/:dj/:M/:"').replace(
        'VOLUME="HD"',
        'VOLUME="Macintosh HD"',
      ),
    )
    const result = await syncCollection(
      nmlPath,
      [{ volume: '', dir: '/:Users/:dj/:M/:', file: 'uno.aiff', newFile: 'uno.flac' }],
      session,
      'Macintosh HD',
    )

    expect(result.written).toBe(true)
    expect(readFileSync(nmlPath, 'utf8')).toContain('uno.flac')
  })

  // The check after the write judges each track against the entry its patch moved, read
  // from the collection the write replaced: afterwards the old name is gone.
  it('names the entry each patch matched before the write, null where Traktor had none', async () => {
    writeFileSync(
      nmlPath,
      NML.replace('DIR="/:M/:"', 'DIR="/:Users/:dj/:M/:"').replace(
        'VOLUME="HD"',
        'VOLUME="Macintosh HD"',
      ),
    )
    const result = await syncCollection(
      nmlPath,
      [
        { volume: '', dir: '/:Users/:dj/:M/:', file: 'uno.wav', newFile: 'uno.flac' },
        { volume: '', dir: '/:Users/:dj/:M/:', file: 'dos.aiff', newFile: 'dos.flac' },
      ],
      session,
      'Macintosh HD',
    )

    expect(result).toMatchObject({ written: true, before: ['uno.aiff', null] })
  })

  it('a run Traktor has none of says so per patch', async () => {
    const result = await syncCollection(
      nmlPath,
      [{ volume: 'HD', dir: '/:M/:', file: 'dos.aiff', newFile: 'dos.flac' }],
      session,
    )

    expect(result).toEqual({ written: false, matched: 0, reason: 'no-matches', before: [null] })
  })

  // Song.wav no está en Traktor y Song.mp3 sí, con sus cues y playlists. Convertir el WAV
  // en su sitio no puede llevarse la ENTRY del MP3 por nombre base: el MP3 sigue en disco
  // y es otra pista, que se quedaría apuntando al FLAC con los cues del WAV.
  it('leaves a same-stem sibling that is still on disk on its own file', async () => {
    writeFileSync(join(dir, 'Song.mp3'), 'mp3')
    const traktorDir = `${dir.replace(/\//g, '/:')}/:`
    writeFileSync(
      nmlPath,
      `<NML VERSION="19"><COLLECTION ENTRIES="1"><ENTRY TITLE="Mp3"><LOCATION DIR="${traktorDir}" FILE="Song.mp3" VOLUME="Macintosh HD"></LOCATION></ENTRY></COLLECTION><PLAYLISTS><NODE TYPE="PLAYLIST" NAME="Set"><PLAYLIST ENTRIES="1" TYPE="LIST"><ENTRY><PRIMARYKEY TYPE="TRACK" KEY="Macintosh HD${traktorDir}Song.mp3"></PRIMARYKEY></ENTRY></PLAYLIST></NODE></PLAYLISTS></NML>`,
    )

    const result = await syncCollection(
      nmlPath,
      [{ volume: '', dir: traktorDir, file: 'Song.wav', newFile: 'Song.flac' }],
      session,
      'Macintosh HD',
    )

    const out = readFileSync(nmlPath, 'utf8')
    expect(out).toContain('FILE="Song.mp3"')
    expect(out).not.toContain('Song.flac')
    expect(result.before).toEqual([null])
  })
})

describe('syncCollection', () => {
  // La colección es la biblioteca entera de un DJ: nunca se escribe sin una copia
  // recuperable al lado, y el backup va ANTES de tocar el original.
  it('writes a backup before touching the collection', async () => {
    const result = await syncCollection(nmlPath, [patch], session)

    expect(result.written).toBe(true)
    expect(readFileSync(backupOf(nmlPath, 'backup'), 'utf8')).toBe(NML)
    expect(readFileSync(nmlPath, 'utf8')).toContain('uno.flac')
  })

  // La copia de cada escritura se pisa en la siguiente: tras tres guardados ya no guarda la
  // colección del DJ. La de la sesión se toma antes de la primera escritura y no se toca
  // hasta la siguiente tanda, para poder volver a como estaba todo antes de empezar.
  it('takes the dated copy through the session it is handed, so the Copias screen hears of it as it does for rekordbox and Engine', async () => {
    const take = vi.fn(async () => ({}) as never)
    await syncCollection(nmlPath, [patch], createSessionBackup({ take }))
    expect(take).toHaveBeenCalledWith(nmlPath, [], 'run')
  })

  it('keeps the collection as it was before the first write of the run, however many follow', async () => {
    session.begin('run')
    await syncCollection(nmlPath, [patch], session)
    writeFileSync(nmlPath, `${NML}<!-- later -->`)
    await syncCollection(nmlPath, [patch], session)
    expect(
      readFileSync(join(copyFolder((await listCopies(nmlPath))[0]), 'collection.nml'), 'utf8'),
    ).toBe(NML)
    expect(readFileSync(backupOf(nmlPath, 'backup'), 'utf8')).toBe(`${NML}<!-- later -->`)
    session.begin('run')
    writeFileSync(nmlPath, `${NML}<!-- next run -->`)
    const beforeNext = readFileSync(nmlPath, 'utf8')
    await syncCollection(nmlPath, [patch], session)
    expect(
      readFileSync(join(copyFolder((await listCopies(nmlPath))[0]), 'collection.nml'), 'utf8'),
    ).toBe(beforeNext)
  })

  // Una copia hereda el modo de lo copiado: una colección de solo lectura dejaba un backup
  // de solo lectura, y copiar el siguiente encima fallaba, bloqueando toda escritura posterior.
  it('replaces a read-only backup left by an earlier write', async () => {
    mkdirSync(dirname(backupOf(nmlPath, 'backup')), { recursive: true })
    writeFileSync(backupOf(nmlPath, 'backup'), 'stale')
    chmodSync(backupOf(nmlPath, 'backup'), 0o444)
    const result = await syncCollection(nmlPath, [patch], session)

    expect(result.written).toBe(true)
    expect(readFileSync(backupOf(nmlPath, 'backup'), 'utf8')).toBe(NML)
  })

  // Traktor carga la colección al arrancar y la reescribe al cerrar: escribir con
  // Traktor abierto se pierde al salir, sin error visible. Mejor no escribir.
  it('refuses to write while Traktor is running', async () => {
    vi.mocked(isTraktorRunning).mockResolvedValue(true)

    const result = await syncCollection(nmlPath, [patch], session)

    expect(result).toMatchObject({ written: false, reason: 'traktor-running' })
    expect(readFileSync(nmlPath, 'utf8')).toBe(NML)
  })

  // Un fichero de respaldo, siempre el mismo, pisado en cada escritura. Antes se
  // guardaba uno con fecha por escritura, y como cada conversión suelta escribe la
  // colección, tres pistas convertidas de una en una dejaban tres .bak al lado —
  // ruido en la carpeta del usuario por algo que él sólo quiere como red de
  // seguridad. Mismo trato que la biblioteca de Engine DJ (m.db.surco-backup).
  // Y en la carpeta de Surco, no al lado de la colección: en un Windows que no dejaba crear
  // ficheros junto a collection.nml, la copia fallaba y ningún guardado llegaba a Traktor.
  it('keeps one backup and one dated copy of the run in Surco folder however many times it writes', async () => {
    await syncCollection(nmlPath, [patch], session)
    writeFileSync(nmlPath, NML)
    await syncCollection(nmlPath, [patch], session)
    writeFileSync(nmlPath, NML)
    await syncCollection(nmlPath, [patch], session)

    expect(readdirSync(dirname(backupOf(nmlPath, 'backup'))).sort()).toEqual([
      'collection.nml.surco-backup',
      'history',
    ])
    expect(readdirSync(dir).filter((f) => f.includes('surco'))).toEqual([])
  })

  // La copia tiene que ser la de ESTA escritura, no la primera de la historia: si
  // conservara la más vieja, el usuario recuperaría un estado anterior al que creía
  // estar deshaciendo.
  it('overwrites the backup with the state from just before this write', async () => {
    await syncCollection(nmlPath, [patch], session)
    const second = NML.replace('uno.aiff', 'dos.aiff')
    writeFileSync(nmlPath, second)

    await syncCollection(nmlPath, [{ ...patch, file: 'dos.aiff' }], session)

    expect(readFileSync(backupOf(nmlPath, 'backup'), 'utf8')).toBe(second)
  })

  // Una pista que no está en la colección no es un error: es el caso normal de
  // "esta no la tiene Traktor". No se escribe, y no se toca el fichero.
  it('does not write when no entry matches', async () => {
    const result = await syncCollection(
      nmlPath,
      [{ volume: 'X', dir: '/:otro/:', file: 'nope.mp3' }],
      session,
    )

    expect(result).toMatchObject({ written: false, reason: 'no-matches' })
    expect(readFileSync(nmlPath, 'utf8')).toBe(NML)
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toHaveLength(0)
  })

  // El NML puede ser de decenas de MB: un lote de N pistas es UNA lectura y UNA
  // escritura, no N reescrituras del fichero entero.
  it('writes once for a batch of several tracks', async () => {
    const many = `<NML VERSION="19"><COLLECTION ENTRIES="2">
<ENTRY TITLE="Uno"><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION></ENTRY>
<ENTRY TITLE="Dos"><LOCATION DIR="/:M/:" FILE="dos.aiff" VOLUME="HD"></LOCATION></ENTRY>
</COLLECTION></NML>`
    writeFileSync(nmlPath, many)

    const result = await syncCollection(
      nmlPath,
      [patch, { volume: 'HD', dir: '/:M/:', file: 'dos.aiff', newFile: 'dos.flac' }],
      session,
    )

    expect(result).toMatchObject({ written: true, matched: 2 })
    expect(readdirSync(dirname(backupOf(nmlPath, 'backup'))).sort()).toEqual([
      'collection.nml.surco-backup',
      'history',
    ])
    const out = readFileSync(nmlPath, 'utf8')
    expect(out).toContain('uno.flac')
    expect(out).toContain('dos.flac')
  })

  // Un lote real mezcla pistas que sí están en la colección con pistas que no. El
  // contador de "matched" tiene que reflejar cuántas se tocaron de verdad, no cuántas
  // se pasaron: si no, un "matched: 2" mentiría sobre una que nunca estuvo en Traktor.
  it('counts only the patches that actually matched an entry', async () => {
    const result = await syncCollection(
      nmlPath,
      [patch, { volume: 'X', dir: '/:otro/:', file: 'nope.mp3' }],
      session,
    )

    expect(result).toMatchObject({ written: true, matched: 1 })
  })

  // El primer chequeo puede pasar y Traktor arrancar justo en la ventana de
  // lectura/backup que sigue: si el segundo chequeo (justo antes del swap) no
  // existiera, este escenario escribiría con Traktor abierto sin que ningún test
  // lo notara.
  it('refuses to write when Traktor starts in the window between the two checks', async () => {
    vi.mocked(isTraktorRunning).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const result = await syncCollection(nmlPath, [patch], session)

    expect(result).toMatchObject({ written: false, reason: 'traktor-running' })
    expect(readFileSync(nmlPath, 'utf8')).toBe(NML)
  })

  // Si el backup falla, la regla es "nada de backup, nada de escritura": el original
  // debe seguir intacto byte a byte, no sólo "no escrito" en el resultado. Sólo se hace
  // fallar copyFile (el directorio sigue escribible) para que esto pruebe el guard en
  // sí — con el directorio de sólo lectura, la escritura habría fallado igual y el
  // test habría pasado aunque el guard no existiera.
  // The DJ only sees "No se pudo hacer la copia de Traktor": on a user's Windows machine the
  // reason (a folder Windows protects, a read-only file) was nowhere, so the log has to say it.
  it('logs why the backup could not be written', async () => {
    copyFileShouldFail.value = true
    vi.mocked(log.warn).mockClear()

    await syncCollection(nmlPath, [patch], session)

    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/backup.*EACCES/))
  })

  it('logs why the collection could not be written', async () => {
    renameShouldFail.value = true
    vi.mocked(log.warn).mockClear()

    await syncCollection(nmlPath, [patch], session)

    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/write.*ENOSPC/))
  })

  it('leaves the collection untouched when the backup cannot be written', async () => {
    copyFileShouldFail.value = true

    const result = await syncCollection(nmlPath, [patch], session)

    expect(result).toMatchObject({ written: false, reason: 'backup-failed' })
    expect(readFileSync(nmlPath, 'utf8')).toBe(NML)
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toHaveLength(0)
  })

  // Un fichero que no se puede leer (permisos, disco desmontado) no es "no hay
  // coincidencias": son motivos distintos y una llamada que dependa del texto exacto
  // de reason no puede recibir el equivocado.
  it('reports the specific reason when the collection cannot be read', async () => {
    chmodSync(nmlPath, 0o000)
    try {
      const result = await syncCollection(nmlPath, [patch], session)

      expect(result).toMatchObject({ written: false, matched: 0, reason: 'unreadable' })
    } finally {
      chmodSync(nmlPath, 0o600)
    }
  })

  // Un fallo al escribir (disco lleno, volumen de sólo lectura) llega DESPUÉS de que
  // el backup ya se hizo — el original sigue a salvo — pero no puede escapar como una
  // excepción sin capturar hacia un caller que ya le dijo al usuario que la conversión
  // fue bien. Y el .surco-tmp fallido no puede quedarse ahí bloqueando el próximo sync.
  it('reports write-failed instead of throwing, and clears the leftover tmp file', async () => {
    renameShouldFail.value = true

    const result = await syncCollection(nmlPath, [patch], session)

    expect(result).toMatchObject({ written: false, matched: 0, reason: 'write-failed' })
    expect(existsSync(`${nmlPath}.surco-tmp`)).toBe(false)
    expect(readFileSync(nmlPath, 'utf8')).toBe(NML)
  })

  // Surco no borra NADA en la carpeta de la colección. Antes rotaba sus propios
  // backups y el filtro tenía que distinguirlos de los ficheros del usuario; ahora
  // que sólo mantiene una copia de nombre fijo, no hay borrado que pueda equivocarse.
  // El usuario guarda copias a mano al lado de su colección (collection ORI.nml,
  // collection buena retocada.nml, y .bak propios), y un sync entero debe dejarlas
  // exactamente donde estaban.
  it('never deletes anything the user keeps beside the collection', async () => {
    mkdirSync(join(dir, 'Backup'))
    writeFileSync(join(dir, 'Backup', 'collection.nml'), 'traktor backup')
    writeFileSync(join(dir, 'collection ORI.nml'), 'user backup')
    writeFileSync(join(dir, 'collection buena retocada.nml'), 'user backup')
    writeFileSync(join(dir, 'collection1.nml'), 'unrelated file')
    writeFileSync(join(dir, 'coleccion a mano.bak'), 'hand-made backup')
    writeFileSync(join(dir, 'collection.nml.surco-2026-07-01T00-00.bak'), 'old dated backup')

    await syncCollection(nmlPath, [patch], session)

    expect(readFileSync(join(dir, 'Backup', 'collection.nml'), 'utf8')).toBe('traktor backup')
    expect(readFileSync(join(dir, 'collection ORI.nml'), 'utf8')).toBe('user backup')
    expect(readFileSync(join(dir, 'collection buena retocada.nml'), 'utf8')).toBe('user backup')
    expect(readFileSync(join(dir, 'collection1.nml'), 'utf8')).toBe('unrelated file')
    expect(readFileSync(join(dir, 'coleccion a mano.bak'), 'utf8')).toBe('hand-made backup')
    expect(readFileSync(join(dir, 'collection.nml.surco-2026-07-01T00-00.bak'), 'utf8')).toBe(
      'old dated backup',
    )
  })
})

// El reporte del 06/09/2026, reproducido en cinco equipos: tras convertir, Traktor
// seguía pintando la carátula vieja. Traktor no lee el arte del audio, lo sirve de su
// propia caché de miniaturas, así que la portada nueva no aparece hasta que esos
// ficheros la llevan. El COVERARTID se conserva: borrarlo sólo lo mandaría a releer la
// misma caché rancia.
describe('syncCollection refreshes the cached artwork', () => {
  const COVER_NML = `<NML VERSION="19"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Uno"><INFO COVERARTID="042/ABC"></INFO><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION></ENTRY>
</COLLECTION></NML>`

  const coverPatch = {
    volume: 'HD',
    dir: '/:M/:',
    file: 'uno.aiff',
    newFile: 'uno.flac',
    refreshCoverArt: true,
    outputPath: '/Music/uno.flac',
  }

  function seedCache(): string {
    const cache = join(dir, 'Coverart', '042')
    mkdirSync(cache, { recursive: true })
    for (const variant of ['000', '001', '002']) {
      writeFileSync(join(cache, `ABC${variant}`), 'stale thumbnail')
    }
    return cache
  }

  // A converted file that coexists with its source has just had AUDIO_ID/COVERARTID
  // stripped, so Traktor knows no artwork for it at all. It mints a fresh id and cache
  // entry only when it sees the audio is newer than the collection it just read — so
  // without this the converted track shows no cover instead of its embedded one. Ahead
  // of the NML rather than merely "now": the collection is written microseconds earlier,
  // and on a filesystem with coarse timestamps the two would otherwise tie.
  it('makes a detached conversion newer than the collection it was written into', async () => {
    const coexisting = `<NML VERSION="19"><COLLECTION ENTRIES="2">
<ENTRY TITLE="Uno"><INFO COVERARTID="042/ABC"></INFO><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION></ENTRY>
<ENTRY TITLE="Uno"><INFO COVERARTID="042/ABC"></INFO><LOCATION DIR="/:M/:" FILE="uno.flac" VOLUME="HD"></LOCATION></ENTRY>
</COLLECTION></NML>`
    writeFileSync(nmlPath, coexisting)
    const audio = join(dir, 'uno.flac')
    writeFileSync(audio, 'audio')
    const stale = new Date(Date.now() - 60_000)
    utimesSync(audio, stale, stale)

    await syncCollection(
      nmlPath,
      [
        {
          volume: 'HD',
          dir: '/:M/:',
          file: 'uno.aiff',
          refreshCoverArt: true,
          outputPath: audio,
          outputVolume: 'HD',
          outputDir: '/:M/:',
          outputFile: 'uno.flac',
        },
      ],
      session,
    )

    expect(statSync(audio).mtimeMs).toBeGreaterThan(statSync(nmlPath).mtimeMs)
  })

  // A substitution keeps its identity and its cache entry, so its artwork is already
  // correct. Touching it would ask Traktor to redo work for nothing, and would rewrite a
  // timestamp the user's own backup and sync tools read.
  it('leaves the file date alone for a substitution', async () => {
    writeFileSync(nmlPath, COVER_NML)
    seedCache()
    const audio = join(dir, 'uno.flac')
    writeFileSync(audio, 'audio')
    const stale = new Date(Date.now() - 60_000)
    utimesSync(audio, stale, stale)

    await syncCollection(nmlPath, [{ ...coverPatch, outputPath: audio }], session)

    expect(statSync(audio).mtimeMs).toBeCloseTo(stale.getTime(), -2)
  })

  it('rewrites the cached thumbnails and keeps the id that points at them', async () => {
    writeFileSync(nmlPath, COVER_NML)
    const cache = seedCache()

    const result = await syncCollection(nmlPath, [coverPatch], session)

    expect(result.written).toBe(true)
    expect(readFileSync(nmlPath, 'utf8')).toContain('COVERARTID="042/ABC"')
    for (const variant of ['000', '001', '002']) {
      expect(readFileSync(join(cache, `ABC${variant}`), 'utf8')).not.toBe('stale thumbnail')
    }
  })

  // Sin escritura no hay nada que refrescar: la miniatura que Traktor tiene sigue
  // correspondiendo a la colección que sigue en disco.
  it('leaves the cache alone when the collection was not written', async () => {
    writeFileSync(nmlPath, COVER_NML)
    const cache = seedCache()
    vi.mocked(isTraktorRunning).mockResolvedValue(true)

    const result = await syncCollection(nmlPath, [coverPatch], session)

    expect(result.written).toBe(false)
    expect(readFileSync(join(cache, 'ABC000'), 'utf8')).toBe('stale thumbnail')
  })

  // Una caché ausente no puede tumbar una sincronización ya escrita: el fichero está
  // convertido y la colección actualizada.
  it('still reports the write when there is no cache to refresh', async () => {
    writeFileSync(nmlPath, COVER_NML)

    const result = await syncCollection(nmlPath, [coverPatch], session)

    expect(result.written).toBe(true)
  })
})

describe('replaceDuplicatesInCollection', () => {
  const BOTH = `<NML VERSION="19"><COLLECTION ENTRIES="2">
<ENTRY TITLE="Old"><LOCATION DIR="/:M/:" FILE="old.aiff" VOLUME="HD"></LOCATION></ENTRY>
<ENTRY TITLE="New"><LOCATION DIR="/:M/:" FILE="new.aiff" VOLUME="HD"></LOCATION></ENTRY>
</COLLECTION><PLAYLISTS><PLAYLIST ENTRIES="1" TYPE="LIST" UUID="p">
<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="HD/:M/:old.aiff"></PRIMARYKEY></ENTRY>
</PLAYLIST></PLAYLISTS></NML>`
  const pair = {
    from: { volume: 'HD', dir: '/:M/:', file: 'old.aiff' },
    to: { volume: 'HD', dir: '/:M/:', file: 'new.aiff' },
  }
  const missing = {
    from: { volume: 'HD', dir: '/:M/:', file: 'none.aiff' },
    to: pair.to,
  }

  beforeEach(() => writeFileSync(nmlPath, BOTH))

  it('writes the collection with a backup of it as it was and says what each pair did', async () => {
    const result = await replaceDuplicatesInCollection(nmlPath, [pair, missing], session)
    expect(result).toEqual({ written: true, outcomes: ['replaced', 'none'] })
    expect(readFileSync(backupOf(nmlPath, 'backup'), 'utf8')).toBe(BOTH)
    const out = readFileSync(nmlPath, 'utf8')
    expect(out).not.toContain('TITLE="Old"')
    expect(out).toContain('KEY="HD/:M/:new.aiff"')
  })

  it('writes nothing and makes no backup when no pair is in the collection', async () => {
    const result = await replaceDuplicatesInCollection(nmlPath, [missing], session)
    expect(result).toEqual({ written: false, outcomes: ['none'] })
    expect(existsSync(backupOf(nmlPath, 'backup'))).toBe(false)
  })

  it('skips every pair while Traktor is running', async () => {
    vi.mocked(isTraktorRunning).mockResolvedValue(true)
    const result = await replaceDuplicatesInCollection(nmlPath, [pair, missing], session)
    expect(result).toEqual({
      written: false,
      reason: 'traktor-running',
      outcomes: ['skipped', 'skipped'],
    })
    expect(readFileSync(nmlPath, 'utf8')).toBe(BOTH)
  })

  it('skips when Traktor starts between the read and the write', async () => {
    vi.mocked(isTraktorRunning).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const result = await replaceDuplicatesInCollection(nmlPath, [pair], session)
    expect(result).toEqual({ written: false, reason: 'traktor-running', outcomes: ['skipped'] })
    expect(readFileSync(nmlPath, 'utf8')).toBe(BOTH)
  })

  it('skips when the backup cannot be made', async () => {
    copyFileShouldFail.value = true
    const result = await replaceDuplicatesInCollection(nmlPath, [pair], session)
    expect(result).toEqual({ written: false, reason: 'backup-failed', outcomes: ['skipped'] })
    expect(readFileSync(nmlPath, 'utf8')).toBe(BOTH)
  })

  it('reports a failed write and keeps the collection', async () => {
    renameShouldFail.value = true
    const result = await replaceDuplicatesInCollection(nmlPath, [pair], session)
    expect(result).toEqual({ written: false, reason: 'write-failed', outcomes: ['failed'] })
    expect(readFileSync(nmlPath, 'utf8')).toBe(BOTH)
    expect(readdirSync(dir)).not.toContain('collection.nml.surco-tmp')
  })

  it('skips when the collection cannot be read', async () => {
    const result = await replaceDuplicatesInCollection(join(dir, 'gone.nml'), [pair], session)
    expect(result).toEqual({ written: false, reason: 'unreadable', outcomes: ['skipped'] })
  })
})

describe('bootVolumeName', () => {
  const entry = (name: string, link: boolean) => ({ name, isSymbolicLink: () => link })

  it('picks the symlink to the root without following any other entry', () => {
    const readlink = vi.fn((path: string) =>
      path === '/Volumes/Macintosh HD' ? '/' : '/Elsewhere',
    )
    const name = bootVolumeName({
      readdir: () => [entry('Public', false), entry('Backup', true), entry('Macintosh HD', true)],
      readlink,
    })
    expect(name).toBe('Macintosh HD')
    expect(readlink).not.toHaveBeenCalledWith('/Volumes/Public')
  })

  it('keeps looking when one entry cannot be read', () => {
    const name = bootVolumeName({
      readdir: () => [entry('Broken', true), entry('Macintosh HD', true)],
      readlink: (path) => {
        if (path === '/Volumes/Broken') throw new Error('EIO')
        return '/'
      },
    })
    expect(name).toBe('Macintosh HD')
  })

  it('is empty when nothing points at the root or the folder cannot be listed', () => {
    expect(bootVolumeName({ readdir: () => [entry('A', true)], readlink: () => '/x' })).toBe('')
    expect(
      bootVolumeName({
        readdir: () => {
          throw new Error('EACCES')
        },
        readlink: () => '/',
      }),
    ).toBe('')
  })
})
