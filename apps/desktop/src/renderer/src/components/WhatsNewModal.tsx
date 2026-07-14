import { Sparkles } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { baseLocale } from '../i18n/locale'
import { changelogReleases } from '../lib/changelog'
import { selectWhatsNew } from '../lib/whatsNew'
import { ModalShell } from './ModalShell'

interface Props {
  // The version stamp the user last saw, snapshotted by App BEFORE it stamps the
  // running version — the modal re-selects its batches from it on every render, so
  // the news follows a mid-session language switch instead of staying frozen in the
  // language of the moment the popup opened.
  lastSeen: string
  onClose: () => void
}

// Shown once right after an update (lib/whatsNew picks the batches, App stamps the
// version so it can never reappear): the changelog entries the user skipped, grouped
// under each release's title. Closing is a single click — no checkbox, because the
// popup already silences itself.
export function WhatsNewModal({ lastSeen, onClose }: Props): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const releases =
    selectWhatsNew(
      changelogReleases(baseLocale(i18n.language)),
      { hasSeenOnboarding: true, lastSeenChangelogVersion: lastSeen },
      window.api.version,
    ) ?? []

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="whats-new-backdrop"
      labelledBy="whats-new-title"
      className="flex max-h-[70vh] w-[480px] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
    >
      <h2 id="whats-new-title" className="flex items-center gap-2 text-base font-semibold">
        <Sparkles size={16} aria-hidden="true" className="text-[var(--color-accent)]" />
        {tr('whatsNew.title')}
      </h2>

      <div className="mt-4 flex-1 space-y-5 overflow-y-auto pr-1">
        {releases.map((release) => (
          <section key={release.version}>
            <div className="flex items-baseline gap-2">
              <span className="rounded-full border border-[var(--color-line)] px-2 py-0.5 font-mono text-xs text-[var(--color-accent)] tabular-nums">
                v{release.version}
              </span>
              <h3 className="text-sm font-medium">{release.title}</h3>
            </div>
            <ul className="mt-2.5 space-y-2">
              {release.items.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-fg-muted">
                  <span className="mt-2 h-1 w-1 flex-none rounded-full bg-[var(--color-accent)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-5 flex justify-end border-t border-[var(--color-line)] pt-4">
        <button
          type="button"
          data-testid="whats-new-close"
          onClick={onClose}
          className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
        >
          {tr('whatsNew.ok')}
        </button>
      </div>
    </ModalShell>
  )
}
