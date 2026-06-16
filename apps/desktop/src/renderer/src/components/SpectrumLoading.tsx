import type React from 'react'
import { useTranslation } from 'react-i18next'

// Holds the exact frame the spectrogram will fill (same height, border and radius) so
// the finished image swaps in without a layout jump. While ffmpeg works, a single faint
// band drifts across the empty frame — a quiet "scanning" cue rather than a busy meter —
// under a low-contrast label that names the wait.
export function SpectrumLoading(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      data-testid="spectrum-loading"
      className="relative flex h-60 w-full items-center justify-center overflow-hidden rounded-lg border border-[var(--color-line)]"
    >
      <span
        aria-hidden="true"
        className="spectrum-scan pointer-events-none absolute inset-y-0 left-0 w-1/3"
      />
      <span className="relative animate-pulse text-xs text-fg-faint">{t('editor.analyzing')}</span>
    </div>
  )
}
