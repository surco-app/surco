// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./traktorProcess', () => ({ isTraktorRunning: vi.fn().mockResolvedValue(false) }))

import { isTraktorRunning } from './traktorProcess'
import { syncCollection } from './traktorNmlLibrary'

const NML = `<NML VERSION="19"><COLLECTION ENTRIES="1">
<ENTRY TITLE="Uno"><LOCATION DIR="/:M/:" FILE="uno.aiff" VOLUME="HD"></LOCATION></ENTRY>
</COLLECTION></NML>`

let dir: string
let nmlPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'surco-nml-'))
  nmlPath = join(dir, 'collection.nml')
  writeFileSync(nmlPath, NML)
  vi.mocked(isTraktorRunning).mockResolvedValue(false)
})

const patch = { volume: 'HD', dir: '/:M/:', file: 'uno.aiff', newFile: 'uno.flac' }

describe('syncCollection', () => {
  // La colección es la biblioteca entera de un DJ: nunca se escribe sin una copia
  // recuperable al lado, y el backup va ANTES de tocar el original.
  it('writes a dated backup before touching the collection', async () => {
    const result = await syncCollection(nmlPath, [patch])

    expect(result.written).toBe(true)
    const backups = readdirSync(dir).filter((f) => f.includes('surco') && f.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(dir, backups[0]), 'utf8')).toBe(NML)
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

  // El flujo real es iterativo (probar, comprobar en Traktor, volver a probar), así
  // que una sola copia pisada en cada escritura deja al usuario sin red. Se rotan 10.
  it('keeps only the ten most recent backups', async () => {
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(dir, `collection.nml.surco-2026-07-0${i % 10}T0${i % 10}-00.bak`), 'old')
    }

    await syncCollection(nmlPath, [patch])

    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toHaveLength(10)
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
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toHaveLength(1)
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
})
