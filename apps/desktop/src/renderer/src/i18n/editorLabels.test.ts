import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const locales = { es, en, de, fr, 'pt-BR': ptBR, ja }

describe.each(Object.entries(locales))('editor labels in %s', (_, t) => {
  it('names the Properties subheads apart from the editor groups, so «Archivo» and «Audio» each mean one place', () => {
    const groups = [t.editor.groupMetadata, t.editor.groupAudio]
    expect(groups).not.toContain(t.editor.propertiesGroupAudio)
    expect(groups).not.toContain(t.editor.propertiesGroupFile)
  })

  it('names the source file apart from the output file, so Properties never reads like the name it will be saved as', () => {
    expect(t.editor.propFileName).not.toBe(t.editor.outputName)
    expect(t.settings.sections.output).toBe(t.editor.outputName)
  })

  it('names the integrated reading apart from its loudness subhead, so one word does not label both the group and a row inside it', () => {
    expect(t.editor.loudnessIntegratedLabel).toEqual(expect.any(String))
    expect(t.editor.loudnessIntegratedLabel).not.toBe(t.editor.loudnessGroupLoudness)
    expect(t.normalize.mode.loudness).toBe(t.editor.loudnessGroupLoudness)
  })

  it('says «off» for normalization the way vinyl repair says it, two segmented controls a few rows apart', () => {
    expect(t.normalize.mode.none).toBe(t.declick.mode.off)
  })
})
