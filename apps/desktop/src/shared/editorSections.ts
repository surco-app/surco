// The editor's collapsible sections, their configurable order and default fold
// state (Settings → Editor). Lives in shared so the renderer and the persisted
// default settings (main/settings) reference the same list and can never drift.

const EDITOR_SECTION_IDS = [
  'form',
  'otherTags',
  'properties',
  'quality',
  'output',
  'trim',
  'declick',
  'normalize',
] as const
export type EditorSectionId = (typeof EDITOR_SECTION_IDS)[number]

// Which phase of the track workflow a section belongs to, so the editor can label a
// group heading whenever the phase changes down the (user-reorderable) list — the
// three phases the default order already reads as, made visible: describe the file,
// operate on its audio, name the output. Derived per section, not a fixed layout, so
// a reordered list still labels correctly (a moved audio section carries its "AUDIO"
// heading with it) rather than forcing sections into fixed buckets.
type EditorSectionGroup = 'metadata' | 'audio' | 'output'

export const EDITOR_SECTION_GROUP: Record<EditorSectionId, EditorSectionGroup> = {
  form: 'metadata',
  otherTags: 'metadata',
  properties: 'metadata',
  quality: 'metadata',
  trim: 'audio',
  declick: 'audio',
  normalize: 'audio',
  output: 'output',
}

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
// Convert button, with the audio sections grouped above it. The list reads as the
// track workflow: identify (the pinned form), inspect the file (properties' passive
// figures, then quality's go/no-go verdict), then the audio surgery in the order the
// conversion applies it — trim the silence first, repair clicks on what remains,
// size the gain on the repaired audio — and the name last.
export const DEFAULT_EDITOR_SECTIONS: EditorSectionPref[] = [
  { id: 'form', open: true },
  // The third-party tags the app doesn't manage. Folded by default, and it renders
  // nothing when the track carries none, so it stays out of the way until it applies.
  { id: 'otherTags', open: false },
  // Reference figures, consulted when the quality verdict raises an eyebrow.
  { id: 'properties', open: false },
  { id: 'quality', open: true },
  // Folded: the header pill still surfaces the "this rip has silence" finding
  // (the attention filter flags it list-wide too), and folded it skips the wave
  // decode for the tracks the user never trims.
  { id: 'trim', open: false },
  // Folded: the rare-use section (most rips are clean), and its click estimate is
  // its own expensive pass; the fold badge still surfaces an active mode.
  { id: 'declick', open: false },
  // Folded: an occasional mastering choice (the mode ships off), and opening it
  // costs a full-length wave decode plus the loudness measure; the fold badge
  // still surfaces an active mode.
  { id: 'normalize', open: false },
  { id: 'output', open: true },
]

// Repairs a stored value into a complete, valid list: unknown/duplicate entries are
// dropped (a hand-edited settings.json), sections the stored file predates are
// INSERTED at their default position — after the nearest default-order neighbour
// the store kept — and the metadata form, the editor's fixed header, is pinned
// first so no consumer defends against it moving. Appending used to dump every
// new section below File Name (Beatgrid landed after the output name on upgraded
// installs), breaking the workflow order the defaults encode while still
// respecting any custom order the user arranged.
export function normalizeEditorSections(value: EditorSectionPref[] | undefined): EditorSectionPref[] {
  const stored = (value ?? []).filter(
    (s, i, all) =>
      EDITOR_SECTION_IDS.includes(s.id) && all.findIndex((o) => o.id === s.id) === i,
  )
  const merged = [...stored]
  for (const [index, def] of DEFAULT_EDITOR_SECTIONS.entries()) {
    if (merged.some((s) => s.id === def.id)) continue
    // The nearest earlier default that survived in the store anchors the insert;
    // with none (empty store), default order itself does.
    const anchors = DEFAULT_EDITOR_SECTIONS.slice(0, index).map((d) => d.id)
    const at = anchors.reduce((best, id) => {
      const found = merged.findIndex((s) => s.id === id)
      return found > best ? found : best
    }, -1)
    merged.splice(at + 1, 0, def)
  }
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
