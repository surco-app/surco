// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { findEntries } from './traktorNml'

const NML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<NML VERSION="19">
<COLLECTION ENTRIES="2">
<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Uno" ARTIST="A">
<LOCATION DIR="/:Musica/:" FILE="uno.aiff" VOLUME="Macintosh HD"></LOCATION>
</ENTRY>
<ENTRY MODIFIED_DATE="2026/7/26" TITLE="Dos" ARTIST="B">
<LOCATION DIR="/:Musica/:" FILE="dos.flac" VOLUME="Macintosh HD"></LOCATION>
</ENTRY>
</COLLECTION>
</NML>`

describe('findEntries', () => {
  // El emparejado por ruta necesita VOLUME+DIR+FILE de cada ENTRY, y los índices
  // exactos del bloque para poder sustituirlo sin tocar el resto del documento.
  it('reads each entry location and its span in the text', () => {
    const entries = findEntries(NML)

    expect(entries).toHaveLength(2)
    expect(entries[0].file).toBe('uno.aiff')
    expect(entries[0].dir).toBe('/:Musica/:')
    expect(entries[0].volume).toBe('Macintosh HD')
    expect(NML.slice(entries[0].start, entries[0].end)).toContain('TITLE="Uno"')
    expect(NML.slice(entries[0].start, entries[0].end)).not.toContain('TITLE="Dos"')
  })

  // Un NML sin colección (o con una vacía) es válido: no hay nada que emparejar.
  it('returns nothing for a collection with no entries', () => {
    expect(findEntries('<NML VERSION="19"><COLLECTION ENTRIES="0"></COLLECTION></NML>')).toEqual([])
  })
})
