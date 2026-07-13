import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { Beatgrid } from '../../../shared/types'
import { useBeatgrid } from '../hooks/useBeatgrid'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { SectionHeader } from './SectionHeader'

interface Props {
  value: Beatgrid | undefined
  open: boolean
  onToggle: () => void
  inputPath: string
}

// The per-track beatgrid for the DJ exports: a constant-tempo grid the user can
// line up with the beats on the wave. The detection only suggests — what the
// exports carry is whatever grid the user confirmed (or left as detected).
export function GridSection({ value, open, onToggle, inputPath }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The detection decodes the opening minutes, so it waits for the selection to
  // rest and for the section to actually be open — same gating as the trim wave.
  const settled = useSettled(SELECTION_SETTLE_MS)
  const { data: detected } = useBeatgrid(inputPath, open && settled)

  return (
    <div data-testid="editor-grid" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        title={tr('grid.title')}
        open={open}
        onToggle={onToggle}
        summary={value || detected ? undefined : tr('grid.summaryNone')}
        summaryTestId="grid-summary"
        right={
          value ? (
            !open ? (
              <span
                data-testid="grid-active-badge"
                className="rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]"
              >
                {`${value.bpm.toFixed(2)} BPM`}
              </span>
            ) : undefined
          ) : detected ? (
            <span
              data-testid="grid-detected-pill"
              className="whitespace-nowrap rounded-full bg-[var(--color-panel-2)] px-2.5 py-1 text-xs font-medium text-fg-muted"
            >
              {tr('grid.detected', { bpm: detected.bpm.toFixed(1) })}
            </span>
          ) : undefined
        }
      />
      {open && (
        <div className="mt-3">
          <p className="mb-3 text-xs text-fg-dim">{tr('grid.hint')}</p>
          {detected === null && !value && (
            <p data-testid="grid-nothing" className="text-[10px] text-fg-dim">
              {tr('grid.nothing')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
