import { useCallback, useState } from 'react'

export type EditorSection = 'form' | 'properties' | 'quality' | 'output' | 'normalize'

// The editor is keyed by track (it remounts per row), which would reset every section's
// collapsed state on each track switch. Holding it in a module-level store instead lets a
// "fold this away for now" survive browsing the crate — the section stays closed (and, via
// the analysis gating that reads `open`, stays unanalysed) until the user reopens it. This
// is deliberately separate from the Settings toggles, which disable a feature outright.
const DEFAULTS: Record<EditorSection, boolean> = {
  form: true,
  properties: false,
  quality: true,
  output: true,
  // Open so the section's waveform (and its clipping peaks) shows without hunting
  // for a fold — the wave is worth seeing even with normalization itself off.
  normalize: true,
}

let store: Record<EditorSection, boolean> = { ...DEFAULTS }

// Test seam: the store outlives renders by design, so without this it would leak folded
// state between tests. Resets it to defaults so each test starts clean.
export function resetEditorSections(): void {
  store = { ...DEFAULTS }
}

// The live folded state of a section, read outside React by the list's hover prefetch so
// folding a section away stops its automatic analysis there too — not just inside the
// editor. Reads the module store directly so it always sees the latest toggle, the same
// way the prefetch reads refs for the latest settings.
export function editorSectionOpen(section: EditorSection): boolean {
  return store[section]
}

export function useEditorSections(): {
  open: Record<EditorSection, boolean>
  setOpen: (section: EditorSection, open: boolean) => void
} {
  // Seed from the live store so a remount (track switch) inherits the last folded state.
  const [open, setLocal] = useState(() => store)
  const setOpen = useCallback((section: EditorSection, value: boolean): void => {
    store = { ...store, [section]: value }
    setLocal(store)
  }, [])
  return { open, setOpen }
}
