import { SETTINGS_TABS, type SettingsTab } from './settingsTabs'

export interface SettingsSearchEntry {
  id: string
  tab: SettingsTab
  label: string
  anchor?: string
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = SETTINGS_TABS.map((tab) => ({
  id: tab,
  tab,
  label: `settings.tabs.${tab}`,
}))
