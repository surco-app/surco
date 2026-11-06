import { describe, expect, it } from 'vitest'
import app from '../../../desktop/src/renderer/src/i18n/locales/ja.json'
import ja from './locales/ja.json'

describe('Japanese instructions name the translated app controls', () => {
  it('uses the Japanese cue section and auto-mark button names', () => {
    const guide = ja.guide.sections.find((section) => section.id === 'rekordbox')
    const cues = ja.useCases.cases.find((entry) => entry.id === 'rekordbox-cues')
    expect(guide?.shotCaption).toContain(app.editor.cues.auto.button)
    expect(cues?.steps[0].text).toContain(app.editor.cues.title)
    expect(cues?.points[0]).toContain(app.editor.cues.auto.button)
    expect(cues?.points[2]).toContain(app.editor.cues.auto.button)
  })

  it('uses the Japanese search, field, and Beatport settings labels', () => {
    const replace = ja.useCases.cases.find((entry) => entry.id === 'find-replace')
    const beatport = ja.useCases.cases.find((entry) => entry.id === 'beatport')
    expect(replace?.points[1]).toContain(app.findReplace.regex)
    expect(replace?.points[2]).toContain(app.settings.tabs.search)
    expect(replace?.points[2]).toContain(app.settings.searchIgnoreWords)
    expect(beatport?.settings[0].note).toContain(app.settings.beatportConnect)
    expect(beatport?.settings[1].note).toContain(app.settings.keyNotations.musical)
    expect(beatport?.steps[2].text).toContain(app.editor.update)
    expect(beatport?.points[1]).toContain(app.settings.tabs.fields)
    expect(beatport?.points[1]).toContain(app.settings.autoFill)
  })

  it('translates the matching indicator and duplicate removal action', () => {
    const tagging = ja.useCases.cases.find((entry) => entry.id === 'in-place')
    const duplicates = ja.useCases.cases.find((entry) => entry.id === 'duplicates')
    expect(tagging?.steps[1].text).toContain(app.header.autoMatchingCount.split(' {{done}}')[0])
    expect(duplicates?.steps[2].text).toContain(app.musicReview.removes)
  })
})
