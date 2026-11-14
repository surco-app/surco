import { Loader2 } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from './Tooltip'

export function BatchRun({
  progress,
  onCancel,
}: {
  progress: { done: number; total: number }
  onCancel: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div data-testid="batch-run" className="space-y-2">
      <p
        data-testid="batch-run-progress"
        className="flex items-center justify-center gap-1.5 text-xs text-fg-dim tabular-nums"
      >
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
        {tr('header.convertingCount', progress)}
      </p>
      <button
        type="button"
        data-testid="batch-run-cancel"
        onClick={onCancel}
        aria-label={tr('header.cancelConvert')}
        className="press group relative w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] py-2.5 text-sm font-medium text-fg hover:bg-[var(--color-line-strong)]"
      >
        {tr('common.cancel')}
        <Tooltip label={tr('header.cancelConvert')} />
      </button>
    </div>
  )
}
