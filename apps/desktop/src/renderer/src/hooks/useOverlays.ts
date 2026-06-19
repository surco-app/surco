import { useCallback, useState } from 'react'

export type SettingsTab = 'general' | 'search' | 'stats' | 'naming' | 'shortcuts'

export interface ConfirmModal {
  title: string
  message: string
  confirmLabel: string
  confirmDisabled?: boolean
  destructive?: boolean
  onConfirm: () => void
}

// The one modal/overlay currently open, or null. A single discriminated union (instead
// of a boolean per modal) makes the "only one open at a time" invariant impossible to
// break, and lets the keyboard/overlay logic read a single value.
export type ActiveModal =
  | { type: 'settings'; tab: SettingsTab }
  | { type: 'onboarding' }
  | { type: 'donateNudge' }
  | { type: 'help' }
  | { type: 'loudnessHelp' }
  | { type: 'findReplace' }
  | { type: 'rename' }
  | { type: 'export' }
  | { type: 'palette' }
  | { type: 'confirm'; confirm: ConfirmModal }
  | null

export interface Overlays {
  activeModal: ActiveModal
  openSettings: (tab?: SettingsTab) => void
  openOnboarding: () => void
  openDonateNudge: () => void
  openHelp: () => void
  openLoudnessHelp: () => void
  openFindReplace: () => void
  openRename: () => void
  openExport: () => void
  openPalette: () => void
  // ⌘K from the keyboard toggles rather than opens, so a second press dismisses it.
  togglePalette: () => void
  openConfirm: (confirm: ConfirmModal) => void
  close: () => void
  // Close only if the palette is still the active modal — a command run from the palette
  // may have opened another modal, which must win over the palette's own close.
  closeIfPalette: () => void
}

// Owns the single-overlay state machine and the typed actions that drive it. Centralizing
// it here (instead of scattered setActiveModal calls) keeps the per-modal openers in one
// place; every action has a stable identity, so it can be handed to memoized children and
// read from a subscribe-once listener without re-binding.
export function useOverlays(): Overlays {
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  const openSettings = useCallback(
    (tab: SettingsTab = 'general') => setActiveModal({ type: 'settings', tab }),
    [],
  )
  const openOnboarding = useCallback(() => setActiveModal({ type: 'onboarding' }), [])
  const openDonateNudge = useCallback(() => setActiveModal({ type: 'donateNudge' }), [])
  const openHelp = useCallback(() => setActiveModal({ type: 'help' }), [])
  const openLoudnessHelp = useCallback(() => setActiveModal({ type: 'loudnessHelp' }), [])
  const openFindReplace = useCallback(() => setActiveModal({ type: 'findReplace' }), [])
  const openRename = useCallback(() => setActiveModal({ type: 'rename' }), [])
  const openExport = useCallback(() => setActiveModal({ type: 'export' }), [])
  const openPalette = useCallback(() => setActiveModal({ type: 'palette' }), [])
  const togglePalette = useCallback(
    () => setActiveModal((m) => (m?.type === 'palette' ? null : { type: 'palette' })),
    [],
  )
  const openConfirm = useCallback(
    (confirm: ConfirmModal) => setActiveModal({ type: 'confirm', confirm }),
    [],
  )
  const close = useCallback(() => setActiveModal(null), [])
  const closeIfPalette = useCallback(
    () => setActiveModal((m) => (m?.type === 'palette' ? null : m)),
    [],
  )
  return {
    activeModal,
    openSettings,
    openOnboarding,
    openDonateNudge,
    openHelp,
    openLoudnessHelp,
    openFindReplace,
    openRename,
    openExport,
    openPalette,
    togglePalette,
    openConfirm,
    close,
    closeIfPalette,
  }
}
