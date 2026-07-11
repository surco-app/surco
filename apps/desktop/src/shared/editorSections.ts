// The editor's collapsible sections, their configurable order and default fold
// state (Settings → Editor). Lives in shared so the renderer and the persisted
// default settings (main/settings) reference the same list and can never drift.

export const EDITOR_SECTION_IDS = [
  'form',
  'properties',
  'quality',
  'output',
  'declick',
  'normalize',
] as const
export type EditorSectionId = (typeof EDITOR_SECTION_IDS)[number]

export interface EditorSectionPref {
  id: EditorSectionId
  // Whether the section starts unfolded when the app launches.
  open: boolean
}

// The file name goes last: it names the output, so it reads best right above the
// Convert button, with the audio sections (quality, normalization) grouped above it.
export const DEFAULT_EDITOR_SECTIONS: EditorSectionPref[] = [
  { id: 'form', open: true },
  { id: 'properties', open: false },
  { id: 'quality', open: true },
  // Click repair sits above normalization, matching the order the conversion
  // applies them in (repair first, then size the gain on the repaired audio).
  { id: 'declick', open: true },
  { id: 'normalize', open: true },
  { id: 'output', open: true },
]

// Repairs a stored value into a complete, valid list: unknown/duplicate entries are
// dropped (a hand-edited settings.json), sections the stored file predates are
// appended with their default state, and the metadata form — the editor's fixed
// header — is pinned first so no consumer defends against it moving.
export function normalizeEditorSections(value: EditorSectionPref[] | undefined): EditorSectionPref[] {
  const stored = (value ?? []).filter(
    (s, i, all) =>
      EDITOR_SECTION_IDS.includes(s.id) && all.findIndex((o) => o.id === s.id) === i,
  )
  const missing = DEFAULT_EDITOR_SECTIONS.filter((d) => !stored.some((s) => s.id === d.id))
  const merged = [...stored, ...missing]
  return [
    ...merged.filter((s) => s.id === 'form'),
    ...merged.filter((s) => s.id !== 'form'),
  ].map((s) => ({ id: s.id, open: s.open }))
}
