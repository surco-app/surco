import { X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { ModalShell } from './ModalShell'

interface Props {
  onClose: () => void
}

const METRICS = ['Lufs', 'Peak', 'Range', 'Crest', 'Balance', 'Dc', 'Noise'] as const

// Plain-language explanation of the loudness pills, opened from the ⓘ button.
// A modal (not an inline panel) keeps the editor uncluttered: the figures need
// explaining once, not on every edit.
export function LoudnessHelpModal({ onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="loudness-help-backdrop"
      dialogTestId="loudness-help"
      labelledBy="loudness-help-title"
      className="flex max-h-[80vh] w-[520px] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
    >
      <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between border-b border-[var(--color-line)] px-6 pt-5 pb-3">
        <h2 id="loudness-help-title" className="text-base font-semibold">
          {tr('editor.loudnessHelpTitle')}
        </h2>
        <button
          type="button"
          data-testid="loudness-help-close"
          onClick={onClose}
          aria-label={tr('common.close')}
          className="press flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="-mx-2 space-y-3 overflow-y-auto px-2 text-sm leading-relaxed text-fg-dim">
        {/* Each metric now carries the band the app itself grades as good, and whether
            Surco can do anything about it. A user wrote asking for exactly this: the
            figures meant nothing without a target to compare them to, and there was no
            way to tell which ones a setting could still fix (loudness, true peak, DC,
            balance) from the ones baked into the master (range, dynamics, noise floor).
            The ranges are the same thresholds lib/quality.ts colours the pills with, so
            the copy and the dots cannot drift apart. */}
        {METRICS.map((m) => (
          <p key={m}>
            <span className="font-medium text-fg">{tr(`editor.loudness${m}Label`)}</span>{' '}
            {tr(`editor.loudness${m}Help`)}{' '}
            <span className="text-fg" data-testid={`loudness-help-range-${m.toLowerCase()}`}>
              {tr(`editor.loudnessRange${m}`)}
            </span>{' '}
            <span data-testid={`loudness-help-fix-${m.toLowerCase()}`}>
              {tr(`editor.loudnessFix${m}`)}
            </span>
          </p>
        ))}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-line)] pt-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-good" />
            {tr('editor.loudnessGradeGood')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-warn" />
            {tr('editor.loudnessGradeWarn')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-danger" />
            {tr('editor.loudnessGradeBad')}
          </span>
        </p>
      </div>
    </ModalShell>
  )
}
