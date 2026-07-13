// The editor's collapsible sections, their configurable order and default fold
// state (Settings → Editor). Lives in shared so the renderer and the persisted
// default settings (main/settings) reference the same list and can never drift.

export const EDITOR_SECTION_IDS = [
  'form',
  'properties',
  'quality',
  'output',
  'trim',
  'declick',
  'normalize',
] as const
export type EditorSectionId = (typeof EDITOR_SECTION_IDS)[number]

export interface EditorSectionPref {
  id: EditorSectionId
  // Whether the section starts unfolded when the app launches.
  open: boolean
  // Whether the section is removed from the editor entirely (Settings → Editor).
  // Optional so files saved before it existed stay valid; absent reads as shown.
  // The form can never carry it — it's the editor itself.
  hidden?: boolean
}

// The file name goes last: it names the output, so it reads best right above the
// Convert button, with the audio sections (quality, normalization) grouped above it.
// The list reads as the workflow: identify (the pinned form), judge the file
// (quality's go/no-go verdict, ahead of the passive properties), then the audio
// surgery in the order the conversion applies it — trim the silence first, repair
// clicks on what remains, size the gain on the repaired audio — and the name last.
export const DEFAULT_EDITOR_SECTIONS: EditorSectionPref[] = [
  { id: 'form', open: true },
  { id: 'quality', open: true },
  // Reference figures, consulted when the quality verdict raises an eyebrow.
  { id: 'properties', open: false },
  // Open: its detection pill only appears once the section has analyzed, and the
  // wave decode is shared with the loudness strip's — opening it costs nothing
  // extra while surfacing the "this rip has silence" finding by default.
  { id: 'trim', open: true },
  // Folded: the rare-use section (most rips are clean), and its click estimate is
  // its own expensive pass; the fold badge still surfaces an active mode.
  { id: 'declick', open: false },
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
  ].map((s) => ({
    id: s.id,
    open: s.open,
    // hidden survives the repair, except on the form — hiding it would blank the
    // whole editor, so a hand-edited flag there is dropped rather than honored.
    ...(s.hidden === true && s.id !== 'form' ? { hidden: true } : {}),
  }))
}
