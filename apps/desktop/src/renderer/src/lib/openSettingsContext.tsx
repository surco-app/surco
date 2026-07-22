import type React from 'react'
import { createContext, useContext } from 'react'
import type { SettingsTab } from './settingsTabs'

// The one global "open Settings on this tab" action. Deep consumers (the Discogs
// panel's token hints) read it from here instead of every layer between them and App
// carrying a pass-through prop it never uses. The default is a no-op, matching
// SettingsContext's convention: a component rendered without a provider (tests that
// don't care about navigation) still works instead of throwing.
const OpenSettingsContext = createContext<(tab?: SettingsTab) => void>(() => {})

export function OpenSettingsProvider({
  open,
  children,
}: {
  open: (tab?: SettingsTab) => void
  children: React.ReactNode
}): React.JSX.Element {
  return <OpenSettingsContext.Provider value={open}>{children}</OpenSettingsContext.Provider>
}

export function useOpenSettings(): (tab?: SettingsTab) => void {
  return useContext(OpenSettingsContext)
}
