import { describe, expect, it } from 'vitest'
import { DEFAULT_EDITOR_SECTIONS, normalizeEditorSections } from './editorSections'

describe('normalizeEditorSections', () => {
  it('returns the defaults for a missing value', () => {
    expect(normalizeEditorSections(undefined)).toEqual(DEFAULT_EDITOR_SECTIONS)
  })

  // A settings.json written by an older Surco predates sections added later: the
  // stored array must gain the missing entries (with their default state) instead of
  // silently dropping whole editor sections from the UI.
  it('inserts sections missing from a stored value at their default position', () => {
    const stored = [
      { id: 'form' as const, open: true },
      { id: 'quality' as const, open: false },
    ]
    const ids = normalizeEditorSections(stored).map((s) => s.id)
    expect(ids).toEqual([
      'form',
      'properties',
      'quality',
      'trim',
      'declick',
      'normalize',
      'output',
    ])
  })

  // The file name is the output's name, so it reads best right above the Convert
  // button — audio sections (quality, normalization) group together above it.
  it('ships the file name as the last section by default', () => {
    expect(DEFAULT_EDITOR_SECTIONS.at(-1)?.id).toBe('output')
  })

  it('keeps the stored order and open flags for known sections', () => {
    const stored = [
      { id: 'form' as const, open: true },
      { id: 'normalize' as const, open: false },
      { id: 'output' as const, open: true },
      { id: 'quality' as const, open: false },
      { id: 'properties' as const, open: true },
    ]
    // The sections this store predates follow their default-order neighbours
    // WHEREVER the user parked those: trim/declick after the properties the user
    // moved — never dumped blindly below the output name.
    expect(normalizeEditorSections(stored)).toEqual([
      { id: 'form', open: true },
      { id: 'normalize', open: false },
      { id: 'output', open: true },
      { id: 'quality', open: false },
      { id: 'properties', open: true },
      { id: 'trim', open: false },
      { id: 'declick', open: false },
    ])
  })

  // The list reads as the track workflow: identify (form), inspect what the file is
  // (properties, then quality's verdict), then the audio surgery in the order the
  // conversion applies it — so reading the editor top-to-bottom reads the pipeline.
  it('orders inspection first and the audio chain in processing order by default', () => {
    const ids = DEFAULT_EDITOR_SECTIONS.map((s) => s.id)
    expect(ids).toEqual([
      'form',
      'properties',
      'quality',
      'trim',
      'declick',
      'normalize',
      'output',
    ])
  })

  // Folded by default: the header pill and the attention filter still surface the
  // "this rip has silence" finding, and folded it skips the wave decode for the
  // tracks the user never trims.
  it('ships silence trim folded by default', () => {
    expect(DEFAULT_EDITOR_SECTIONS.find((s) => s.id === 'trim')?.open).toBe(false)
  })

  // Click repair is the rare-use section (most rips are clean), so it ships folded —
  // the fold badge still shows when a mode is active.
  it('ships click repair folded by default', () => {
    expect(DEFAULT_EDITOR_SECTIONS.find((s) => s.id === 'declick')?.open).toBe(false)
  })

  // Normalization is an occasional mastering choice (the mode ships off), and open it
  // costs a full-length wave decode plus the loudness measure — folded, with the fold
  // badge carrying an active mode.
  it('ships loudness normalization folded by default', () => {
    expect(DEFAULT_EDITOR_SECTIONS.find((s) => s.id === 'normalize')?.open).toBe(false)
  })

  // A hidden section stays hidden across the repair — losing the flag would resurface
  // sections the user explicitly removed from the editor.
  it('keeps the hidden flag for known sections', () => {
    const stored = [
      { id: 'form' as const, open: true },
      { id: 'properties' as const, open: false, hidden: true },
    ]
    const props = normalizeEditorSections(stored).find((s) => s.id === 'properties')
    expect(props).toEqual({ id: 'properties', open: false, hidden: true })
  })

  // The metadata form is the editor itself — a hand-edited file must not be able to
  // blank the whole panel by hiding it.
  it('never lets the metadata form be hidden', () => {
    const stored = [{ id: 'form' as const, open: true, hidden: true }]
    expect(normalizeEditorSections(stored)[0]).toEqual({ id: 'form', open: true })
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
    expect(ids).toEqual([
      'form',
      'properties',
      'quality',
      'trim',
      'declick',
      'normalize',
      'output',
    ])
  })
})
