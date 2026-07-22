import type React from 'react'
import { useEffect, useState } from 'react'
import type { Settings, ThemePref } from '../../../shared/types'
import i18n from '../i18n'
import { resolveLocale } from '../i18n/locale'
import { resolveTheme } from '../lib/theme'
import { useLatest } from './useLatest'

interface Params {
  // True while the Settings modal is open, driving the re-read below.
  settingsOpen: boolean
  // Fired once with the first loaded settings, so App can pick the launch modal
  // (the onboarding wizard) — a decision that belongs to App, not here.
  onFirstLoad: (s: Settings) => void
  onLoadError: () => void
  onSaveError: () => void
}

interface SettingsState {
  settings: Settings | null
  // Direct writer for flows that replace the whole object at once (the Settings
  // modal's config-dir adoption).
  setSettings: React.Dispatch<React.SetStateAction<Settings | null>>
  saveSettings: (patch: Partial<Settings>) => void
  // Live theme preview while the Settings modal is open; null clears it.
  setThemePreview: (pref: ThemePref | null) => void
}

// Owns the persisted settings: the initial load, the modal-open refresh, applying the
// theme to the document, and the optimistic save.
export function useSettings({
  settingsOpen,
  onFirstLoad,
  onLoadError,
  onSaveError,
}: Params): SettingsState {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [themePreview, setThemePreview] = useState<ThemePref | null>(null)
  // The load effect runs once; reading the callbacks through a ref keeps it that way
  // without freezing App's closures from the first render.
  const latest = useLatest({ onFirstLoad, onLoadError, onSaveError })

  useEffect(() => {
    window.api
      .getSettings()
      .then((s) => {
        setSettings(s)
        latest.current.onFirstLoad(s)
      })
      // A failed read leaves the whole session on defaults (and suppresses
      // onboarding); it must say so rather than look like a fresh install.
      .catch(() => latest.current.onLoadError())
  }, [latest])

  // Conversions and the lifetime tallies bump their persisted counts from the main
  // process, so re-read settings each time the Settings modal opens to keep the Stats
  // tab current within a session. Only the counters are merged in — never the whole
  // object: a save or config-dir adoption can land while this read is still in flight,
  // and replacing everything would revert those just-applied fields. The cancel flag
  // still drops it once the modal closes.
  useEffect(() => {
    if (!settingsOpen) return
    let cancelled = false
    window.api.getSettings().then((s) => {
      if (!cancelled) {
        setSettings((cur) =>
          cur ? { ...cur, conversionCount: s.conversionCount, stats: s.stats } : s,
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [settingsOpen])

  useEffect(() => {
    const pref = themePreview ?? settings?.theme ?? 'system'
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      document.documentElement.dataset.theme = resolveTheme(pref, mq.matches)
    }
    apply()
    if (pref !== 'system') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [themePreview, settings?.theme])

  // Apply the saved UI language once settings load and whenever it changes. The ⌘⇧L
  // toggle flips i18n directly for a quick switch without persisting; since this only
  // re-runs when the saved preference itself changes, that flip survives.
  useEffect(() => {
    void i18n.changeLanguage(resolveLocale(settings?.language ?? 'system'))
  }, [settings?.language])

  function saveSettings(patch: Partial<Settings>): void {
    // Apply the whole patch optimistically: on a slow config volume the disk round-trip
    // is visible lag, so a toggle or the theme would only respond once the write lands.
    // Started as special cases for theme and resultsWidth; every field the UI can flip
    // deserves the same click-frame answer. The resolved write reconciles below.
    let prev: Settings | null = null
    setSettings((s) => {
      if (!s) return s
      prev = s
      return { ...s, ...patch }
    })
    window.api
      .saveSettings(patch)
      .then(setSettings)
      .catch(() => {
        // The optimistic value never hit disk, so leaving it on screen would show a
        // choice the next launch quietly reverts. Roll back just the patched fields —
        // a concurrent save of other fields keeps its own optimistic state.
        const before = prev
        if (before) {
          setSettings((s) => {
            if (!s) return s
            const reverted = { ...s }
            for (const key of Object.keys(patch) as (keyof Settings)[]) {
              ;(reverted as Record<keyof Settings, unknown>)[key] = before[key]
            }
            return reverted
          })
        }
        latest.current.onSaveError()
      })
  }

  return { settings, setSettings, saveSettings, setThemePreview }
}
