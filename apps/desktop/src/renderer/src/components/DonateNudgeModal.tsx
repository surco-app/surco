import { Heart } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DONATE_URL } from '../lib/donate'
import { formatTimeSaved, timeSavedSeconds } from '../lib/stats'
import { ModalShell } from './ModalShell'

interface Props {
  conversionCount: number
  onClose: (dismissForever: boolean) => void
}

// The occasional "look what Surco saved you" summary with a soft donate ask —
// the same numbers as Settings → Stats, surfaced rarely (see lib/donateNudge for
// the gating). Closing is always one click; only the explicit checkbox silences
// it forever, and that choice is the user's, never implied.
export function DonateNudgeModal({ conversionCount, onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [dismiss, setDismiss] = useState(false)

  return (
    <ModalShell
      onClose={() => onClose(dismiss)}
      backdropTestId="donate-nudge-backdrop"
      labelledBy="donate-nudge-title"
      className="w-[440px] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
    >
      <h2 id="donate-nudge-title" className="text-center text-base font-semibold">
        {tr('donateNudge.title')}
      </h2>

      <div className="mt-6 flex flex-col items-center text-center">
        <p data-testid="donate-nudge-count" className="text-5xl font-semibold tabular-nums">
          {conversionCount}
        </p>
        <p className="mt-1 text-sm text-fg-muted">{tr('settings.stats.count')}</p>
        <p data-testid="donate-nudge-time" className="mt-4 text-sm text-fg">
          {tr('settings.stats.timeSaved', {
            time: formatTimeSaved(timeSavedSeconds(conversionCount)),
          })}
        </p>
      </div>

      <p className="mt-6 text-center text-sm leading-relaxed text-fg-muted">
        {tr('donateNudge.pitch')}
      </p>

      <div className="mt-5 flex justify-center">
        <a
          data-testid="donate-nudge-cta"
          href={DONATE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onClose(dismiss)}
          className="press inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          <Heart size={14} aria-hidden="true" />
          {tr('settings.stats.donateCta')}
        </a>
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-[var(--color-line)] pt-4">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-dim">
          <input
            data-testid="donate-nudge-dismiss"
            type="checkbox"
            checked={dismiss}
            onChange={(e) => setDismiss(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          {tr('donateNudge.dontShowAgain')}
        </label>
        <button
          type="button"
          data-testid="donate-nudge-close"
          onClick={() => onClose(dismiss)}
          className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-panel-2)]"
        >
          {tr('donateNudge.later')}
        </button>
      </div>
    </ModalShell>
  )
}
