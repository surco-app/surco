import { describe, expect, it } from 'vitest'
import { saveAllKey } from './CuesSection'

describe('saveAllKey names the libraries Save all will write to', () => {
  it('speaks of rekordbox when nothing is unsaved', () => {
    expect(saveAllKey(new Set())).toBe('editor.cues.saveAll')
  })

  it('speaks of rekordbox when only rekordbox tracks wait', () => {
    expect(saveAllKey(new Set(['123']))).toBe('editor.cues.saveAll')
  })

  it('speaks of Traktor when only Traktor tracks wait', () => {
    expect(saveAllKey(new Set(['traktor:a']))).toBe('editor.cues.traktor.saveAll')
  })

  it('says it mixes libraries when a Traktor track waits beside a rekordbox one', () => {
    expect(saveAllKey(new Set(['traktor:a', '123']))).toBe('editor.cues.saveAllMixed')
  })

  it('says it mixes libraries when a Traktor track waits beside an Engine DJ one', () => {
    expect(saveAllKey(new Set(['traktor:a', 'engine:1']))).toBe('editor.cues.saveAllMixed')
  })

  it('speaks of Engine DJ when only Engine DJ tracks wait', () => {
    expect(saveAllKey(new Set(['engine:1']))).toBe('editor.cues.engine.saveAll')
  })

  it('names both when an Engine DJ track waits beside a rekordbox one', () => {
    expect(saveAllKey(new Set(['engine:1', '123']))).toBe('editor.cues.saveAllBoth')
  })
})
