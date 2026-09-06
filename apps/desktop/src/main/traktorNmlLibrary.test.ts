// @vitest-environment node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    if (renameShouldFail.value) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })
    return real.rename(...args)
  }) as typeof real.rename
  const copyFile: typeof real.copyFile = (async (...args: Parameters<typeof real.copyFile>) => {
    if (copyFileShouldFail.value) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    return real.copyFile(...args)
  }) as typeof real.copyFile
  return { ...real, rename, copyFile }
})

import { syncCollection } from './traktorNmlLibrary'
import { isTraktorRunning } from './traktorProcess'

const NML = `<NML VERSION="19"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Uno"><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION></ENTRY>
</COLLECTION></NML>`

let dir: string
let nmlPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'surco-nml-'))
  nmlPath = join(dir, 'collection.nml')
  writeFileSync(nmlPath, NML)
  // mockReset (not just a fresh mockResolvedValue) clears any mockResolvedValueOnce
  // left queued by the race test — without it, that queued value leaks into whichever
  // test happens to run next and fails it with the wrong reason.
  vi.mocked(isTraktorRunning).mockReset().mockResolvedValue(false)
  renameShouldFail.value = false
  copyFileShouldFail.value = false
})

const patch = { volume: 'HD', dir: '/:M/:', file: 'uno.aiff', newFile: 'uno.flac' }

describe('syncCollection', () => {
  // La colección es la biblioteca entera de un DJ: nunca se escribe sin una copia
  // recuperable al lado, y el backup va ANTES de tocar el original.
  it('writes a backup before touching the collection', async () => {
    const result = await syncCollection(nmlPath, [patch])

    expect(result.written).toBe(true)
    expect(readFileSync(`${nmlPath}.surco-backup`, 'utf8')).toBe(NML)
    expect(readFileSync(nmlPath, 'utf8')).toContain('uno.flac')
  })

  // Traktor carga la colección al arrancar y la reescribe al cerrar: escribir con
  // Traktor abierto se pierde al salir, sin error visible. Mejor no escribir.
  it('refuses to write while Traktor is running', async () => {
    vi.mocked(isTraktorRunning).mockResolvedValue(true)

    const result = await syncCollection(nmlPath, [patch])

    expect(result).toMatchObject({ written: false, reason: 'traktor-running' })
    expect(readFileSync(nmlPath, 'utf8')).toBe(NML)
  })

  // Un fichero de respaldo, siempre el mismo, pisado en cada escritura. Antes se
  // guardaba uno con fecha por escritura, y como cada conversión suelta escribe la
  // colección, tres pistas convertidas de una en una dejaban tres .bak al lado —
  // ruido en la carpeta del usuario por algo que él sólo quiere como red de
  // seguridad. Mismo trato que la biblioteca de Engine DJ (m.db.surco-backup).
  it('keeps exactly one backup however many times it writes', async () => {
    await syncCollection(nmlPath, [patch])
    writeFileSync(nmlPath, NML)
    await syncCollection(nmlPath, [patch])
    writeFileSync(nmlPath, NML)
    await syncCollection(nmlPath, [patch])

    const leftovers = readdirSync(dir).filter((f) => f.includes('surco'))
    expect(leftovers).toEqual(['collection.nml.surco-backup'])
  })

  // La copia tiene que ser la de ESTA escritura, no la primera de la historia: si
  // conservara la más vieja, el usuario recuperaría un estado anterior al que creía
  // estar deshaciendo.
  it('overwrites the backup with the state from just before this write', async () => {
    await syncCollection(nmlPath, [patch])
    const second = NML.replace('uno.aiff', 'dos.aiff')
    writeFileSync(nmlPath, second)

    await syncCollection(nmlPath, [{ ...patch, file: 'dos.aiff' }])

    expect(readFileSync(`${nmlPath}.surco-backup`, 'utf8')).toBe(second)
  })

  // Una pista que no está en la colección no es un error: es el caso normal de
  // "esta no la tiene Traktor". No se escribe, y no se toca el fichero.
  it('does not write when no entry matches', async () => {
    const result = await syncCollection(nmlPath, [
      { volume: 'X', dir: '/:otro/:', file: 'nope.mp3' },
    ])

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

    const result = await syncCollection(nmlPath, [
      patch,
      { volume: 'HD', dir: '/:M/:', file: 'dos.aiff', newFile: 'dos.flac' },
    ])

    expect(result).toMatchObject({ written: true, matched: 2 })
    expect(readdirSync(dir).filter((f) => f.includes('surco'))).toEqual([
      'collection.nml.surco-backup',
    ])
    const out = readFileSync(nmlPath, 'utf8')
    expect(out).toContain('uno.flac')
    expect(out).toContain('dos.flac')
  })

  // Un lote real mezcla pistas que sí están en la colección con pistas que no. El
  // contador de "matched" tiene que reflejar cuántas se tocaron de verdad, no cuántas
  // se pasaron: si no, un "matched: 2" mentiría sobre una que nunca estuvo en Traktor.
  it('counts only the patches that actually matched an entry', async () => {
    const result = await syncCollection(nmlPath, [
      patch,
      { volume: 'X', dir: '/:otro/:', file: 'nope.mp3' },
    ])

    expect(result).toMatchObject({ written: true, matched: 1 })
  })

  // El primer chequeo puede pasar y Traktor arrancar justo en la ventana de
  // lectura/backup que sigue: si el segundo chequeo (justo antes del swap) no
  // existiera, este escenario escribiría con Traktor abierto sin que ningún test
  // lo notara.
  it('refuses to write when Traktor starts in the window between the two checks', async () => {
    vi.mocked(isTraktorRunning).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const result = await syncCollection(nmlPath, [patch])

    expect(result).toMatchObject({ written: false, reason: 'traktor-running' })
    expect(readFileSync(nmlPath, 'utf8')).toBe(NML)
  })

  // Si el backup falla, la regla es "nada de backup, nada de escritura": el original
  // debe seguir intacto byte a byte, no sólo "no escrito" en el resultado. Sólo se hace
  // fallar copyFile (el directorio sigue escribible) para que esto pruebe el guard en
  // sí — con el directorio de sólo lectura, la escritura habría fallado igual y el
  // test habría pasado aunque el guard no existiera.
  it('leaves the collection untouched when the backup cannot be written', async () => {
    copyFileShouldFail.value = true

    const result = await syncCollection(nmlPath, [patch])

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
      const result = await syncCollection(nmlPath, [patch])

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

    const result = await syncCollection(nmlPath, [patch])

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

    await syncCollection(nmlPath, [patch])

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
// seguía pintando la carátula vieja. Quitar COVERARTID sólo le pide que relea, y lo
// que relee es la miniatura que ya tiene escrita en su caché Coverart. Borrar esos
// ficheros es lo que retira de verdad la imagen antigua; Traktor los regenera solo.
describe('syncCollection drops the cached artwork', () => {
  const COVER_NML = `<NML VERSION="19"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Uno"><INFO COVERARTID="042/ABC"></INFO><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION></ENTRY>
</COLLECTION></NML>`

  const coverPatch = {
    volume: 'HD',
    dir: '/:M/:',
    file: 'uno.aiff',
    newFile: 'uno.flac',
    clearCoverArt: true,
  }

  function seedCache(): string {
    const cache = join(dir, 'Coverart', '042')
    mkdirSync(cache, { recursive: true })
    for (const variant of ['000', '001', '002']) {
      writeFileSync(join(cache, `ABC${variant}`), 'stale thumbnail')
    }
    return cache
  }

  it('deletes the cached thumbnails of the tracks it cleared', async () => {
    writeFileSync(nmlPath, COVER_NML)
    const cache = seedCache()

    const result = await syncCollection(nmlPath, [coverPatch])

    expect(result.written).toBe(true)
    expect(readdirSync(cache)).toEqual([])
  })

  // Sin escritura no hay nada que invalidar: si la colección se quedó como estaba,
  // la miniatura que Traktor tiene sigue siendo la correcta.
  it('keeps the cache when the collection was not written', async () => {
    writeFileSync(nmlPath, COVER_NML)
    const cache = seedCache()
    vi.mocked(isTraktorRunning).mockResolvedValue(true)

    const result = await syncCollection(nmlPath, [coverPatch])

    expect(result.written).toBe(false)
    expect(readdirSync(cache).sort()).toEqual(['ABC000', 'ABC001', 'ABC002'])
  })

  // Una caché que no existe no puede tumbar una sincronización ya escrita: el fichero
  // está convertido y la colección actualizada, y lo único que queda pendiente es que
  // Traktor regenere la miniatura por su cuenta.
  it('still reports the write when there is no cache to clean', async () => {
    writeFileSync(nmlPath, COVER_NML)

    const result = await syncCollection(nmlPath, [coverPatch])

    expect(result.written).toBe(true)
  })
})
