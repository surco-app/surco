import { X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { Settings } from '../../../shared/types'
import { ModalShell } from './ModalShell'
import { StatsTab } from './settings/StatsTab'

interface Props {
  settings: Settings
  onClose: () => void
}

export function StatsModal({ settings, onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="stats-backdrop"
      dialogTestId="stats-modal"
      labelledBy="stats-title"
      className="flex max-h-[84vh] w-[620px] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
    >
      <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between border-b border-[var(--color-line)] px-6 pt-5 pb-3">
        <h2 id="stats-title" className="text-base font-semibold">
          {tr('header.stats')}
        </h2>
        <button
          type="button"
          data-testid="stats-close"
          onClick={onClose}
          aria-label={tr('common.close')}
          className="press flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="-mx-2 overflow-y-auto px-2">
        <StatsTab settings={settings} />
      </div>
    </ModalShell>
  )
}
