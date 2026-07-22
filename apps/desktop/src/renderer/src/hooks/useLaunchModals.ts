import type { Settings } from '../../../shared/types'
import { resolveLocale } from '../i18n/locale'
import { changelogReleases } from '../lib/changelog'
import { shouldShowDonateNudge } from '../lib/donateNudge'
import { shouldShowOnboarding } from '../lib/onboarding'
import { selectWhatsNew } from '../lib/whatsNew'
import type { Overlays } from './useOverlays'
import { useStableCallback } from './useStableCallback'

interface Params {
  overlays: Overlays
  saveSettings: (patch: Partial<Settings>) => void
  // Adopts the fresh read the donate check makes, so the modal shows the live totals
  // the conversion just recorded in main.
  setSettings: (s: Settings) => void
}

interface LaunchModals {
  // The launch decision, fed to useSettings' onFirstLoad: onboarding for a fresh
  // install, otherwise the post-update what's-new popup when there is news.
  decideOnLoad: (s: Settings) => void
  maybeShowDonateNudge: () => Promise<void>
  finishOnboarding: (patch: Partial<Settings>) => void
}

// Which modal greets the user — onboarding, what's-new or the donate nudge — and the
// stamps that keep each from repeating. One machine in one place: the three flows
// used to sit apart in App, each reading and stamping settings its own way.
export function useLaunchModals({ overlays, saveSettings, setSettings }: Params): LaunchModals {
  const decideOnLoad = useStableCallback((s: Settings) => {
    if (shouldShowOnboarding(s)) {
      overlays.openOnboarding()
    } else {
      // Post-update news: the changelog items shipped between the version this
      // machine last saw and the one now running (lib/whatsNew decides whether there
      // is anything). The modal only gets the last-seen stamp — it re-selects the
      // localized items itself, so the news follows a language switch live.
      const news = selectWhatsNew(
        changelogReleases(resolveLocale(s.language)),
        s,
        window.api.version,
      )
      if (news) overlays.openWhatsNew(s.lastSeenChangelogVersion)
    }
    // Stamped on every version change — including the fresh install that showed
    // onboarding instead — so the popup fires once per update and a brand-new
    // user's second launch can't "discover" the current changelog.
    if (s.lastSeenChangelogVersion !== window.api.version) {
      // Through the hook's save (not a bare window.api call) so a failed stamp
      // rolls back and surfaces the error card instead of rejecting into the void.
      saveSettings({ lastSeenChangelogVersion: window.api.version })
    }
  })
  // Evaluated after a conversion run — the moment of value, when the savings summary
  // means something. Re-reads settings so the conversion just recorded in main is
  // counted and the modal shows the live total; never stomps an open modal. The
  // showing is stamped immediately (not on close) so a quick quit still counts toward
  // the cooldown and it can never appear twice in a row.
  const maybeShowDonateNudge = useStableCallback(async () => {
    if (overlays.activeModal !== null) return
    const s = await window.api.getSettings()
    if (!shouldShowDonateNudge(s, new Date(), Math.random())) return
    setSettings(s)
    overlays.openDonateNudge()
    saveSettings({ donateNudgeLastShown: new Date().toISOString() })
  })
  const finishOnboarding = useStableCallback((patch: Partial<Settings>) => {
    saveSettings(patch)
    overlays.close()
  })
  return { decideOnLoad, maybeShowDonateNudge, finishOnboarding }
}
