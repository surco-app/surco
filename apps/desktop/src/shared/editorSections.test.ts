import { describe, expect, it } from 'vitest'
import { DEFAULT_EDITOR_SECTIONS, normalizeEditorSections } from './editorSections'

describe('normalizeEditorSections', () => {
  it('returns the defaults for a missing value', () => {
    expect(normalizeEditorSections(undefined)).toEqual(DEFAULT_EDITOR_SECTIONS)
  })

  // A settings.json written by an older Surco predates sections added later: the
  // stored array must gain the missing entries (with their default state) instead of
  // silently dropping whole editor sections from the UI.
  it('appends sections missing from a stored value', () => {
    const stored = [
      { id: 'form' as const, open: true },
      { id: 'quality' as const, open: false },
    ]
    const ids = normalizeEditorSections(stored).map((s) => s.id)
    expect(ids).toEqual(['form', 'quality', 'properties', 'output', 'normalize'])
  })

  it('keeps the stored order and open flags for known sections', () => {
    const stored = [
      { id: 'form' as const, open: true },
      { id: 'normalize' as const, open: false },
      { id: 'output' as const, open: true },
      { id: 'quality' as const, open: false },
      { id: 'properties' as const, open: true },
    ]
    expect(normalizeEditorSections(stored)).toEqual(stored)
  })

  // The metadata form is the editor's header (toolbar, Apple Music badge) — the one
  // section that cannot move. Pinning it here means no UI needs to defend against a
  // hand-edited settings.json placing it elsewhere.
  it('pins the metadata form first whatever the stored order says', () => {
    const stored = [
      { id: 'quality' as const, open: true },
      { id: 'form' as const, open: false },
    ]
    expect(normalizeEditorSections(stored)[0]).toEqual({ id: 'form', open: false })
  })

  it('drops unknown and duplicate entries from a hand-edited file', () => {
    const stored = [
      { id: 'form', open: true },
      { id: 'bogus', open: true },
      { id: 'quality', open: true },
      { id: 'quality', open: false },
    ] as unknown as Parameters<typeof normalizeEditorSections>[0]
    const ids = normalizeEditorSections(stored)?.map((s) => s.id)
    expect(ids).toEqual(['form', 'quality', 'properties', 'output', 'normalize'])
  })
})
