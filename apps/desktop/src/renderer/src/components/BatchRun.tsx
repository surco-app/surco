import type React from 'react'
import { useId } from 'react'
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
  const progressId = useId()
  const share = progress.total > 0 ? progress.done / progress.total : 0
  return (
    <div data-testid="batch-run" className="flex">
      <button
        type="button"
        data-testid="batch-run-cancel"
        onClick={onCancel}
        aria-label={tr('header.cancelConvert')}
        aria-describedby={progressId}
        className="press group relative flex-1 overflow-hidden rounded-lg bg-[var(--color-accent)]/40 py-2.5 text-sm font-medium text-[var(--color-on-accent)]"
      >
        <span
          data-testid="batch-run-fill"
          aria-hidden="true"
          className="absolute inset-0 origin-left bg-[var(--color-accent)] transition-transform duration-240 ease-standard"
          style={{ transform: `scaleX(${share})` }}
        />
        <span aria-hidden="true" className="progress-sweep absolute inset-0" />
        <span
          id={progressId}
          data-testid="batch-run-progress"
          className="relative tabular-nums group-hover:hidden group-focus-visible:hidden"
        >
          {tr('header.convertingCount', progress)}
        </span>
        <span className="relative hidden group-hover:inline group-focus-visible:inline">
          {tr('common.cancel')}
        </span>
        <Tooltip label={tr('header.cancelConvert')} />
      </button>
    </div>
  )
}
