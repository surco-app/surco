import type { TFunction } from 'i18next'
import { FilePlus, Gauge, type LucideIcon, Snail, Sparkles } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SweepTask } from '../lib/progress'
import { formatCount } from '../lib/stats'

export function sweepText(
  tr: TFunction,
  language: string,
  task: SweepTask,
  slowed: boolean,
): { label: string; count: string } {
  const label =
    task.kind === 'import'
      ? tr('header.sweepImport')
      : task.kind === 'match'
        ? tr('header.sweepMatch')
        : slowed
          ? tr('header.sweepAnalyzeSlowed')
          : task.stage === 'details'
            ? tr('header.sweepAnalyzeDetails')
            : tr('header.sweepAnalyze')
  const count = tr('header.sweepCount', {
    done: formatCount(task.done, language),
    total: formatCount(task.total, language),
  })
  return { label, count }
}

function iconFor(task: SweepTask, slowed: boolean): LucideIcon {
  if (task.kind === 'import') return FilePlus
  if (task.kind === 'match') return Sparkles
  return slowed ? Snail : Gauge
}

export function SweepsPill({
  tasks,
  slowed,
  onStop,
}: {
  tasks: SweepTask[]
  slowed: boolean
  onStop: Record<SweepTask['kind'], () => void>
}): React.JSX.Element | null {
  const { t: tr, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    const onPointer = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const lead = tasks[0]
  if (!lead) return null
  const fraction = lead.done / lead.total
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="sweeps-pill"
        aria-expanded={open}
        aria-label={tr('header.sweeps')}
        onClick={() => setOpen((v) => !v)}
        className={`press flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs font-medium hover:bg-[var(--color-hover)] ${
          open ? 'bg-[var(--color-hover)]' : ''
        }`}
      >
        <span className="flex items-center gap-1">
          {tasks.map((task, i) => {
            const Icon = iconFor(task, slowed)
            return (
              <Icon
                key={task.kind}
                data-testid={`sweep-icon-${task.kind}`}
                aria-hidden="true"
                className={`h-4 w-4 ${i === 0 ? 'text-[var(--color-accent)]' : 'text-fg-faint'}`}
              />
            )
          })}
        </span>
        <span className="h-1 w-14 overflow-hidden rounded-full bg-[var(--color-line-strong)]">
          <span
            className="block h-full origin-left bg-[var(--color-accent)] transition-transform duration-200 ease-standard"
            style={{ transform: `scaleX(${fraction})` }}
          />
        </span>
        <span
          data-testid="sweeps-percent"
          className="min-w-[4.5ch] text-right text-fg-muted tabular-nums"
        >
          {new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(fraction)}
        </span>
      </button>
      {open && (
        <div
          data-testid="sweeps-menu"
          className="animate-pop-flat absolute top-full right-0 z-50 mt-1.5 grid w-80 origin-top-right gap-3.5 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-3.5 text-xs shadow-[var(--shadow-float)]"
        >
          {tasks.map((task) => {
            const { label, count } = sweepText(tr, i18n.language, task, slowed)
            const unread = task.kind === 'match' && task.total > task.done + task.waiting
            return (
              <div
                key={task.kind}
                data-testid={`sweep-${task.kind}`}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5"
              >
                <span className="truncate font-medium text-fg">{label}</span>
                <button
                  type="button"
                  data-testid={`sweep-${task.kind}-stop`}
                  onClick={onStop[task.kind]}
                  className="press row-span-3 rounded-md border border-[var(--color-line-strong)] px-2 py-1 text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
                >
                  {tr('header.sweepStop')}
                </button>
                <span className="relative h-1 overflow-hidden rounded-full bg-[var(--color-line-strong)]">
                  {task.kind === 'match' && (
                    <span
                      className="absolute inset-y-0 left-0 bg-[var(--color-accent)] opacity-30"
                      style={{ width: `${((task.done + task.waiting) / task.total) * 100}%` }}
                    />
                  )}
                  <span
                    className="absolute inset-y-0 left-0 bg-[var(--color-accent)]"
                    style={{ width: `${(task.done / task.total) * 100}%` }}
                  />
                </span>
                <span className="text-fg-muted tabular-nums">
                  {count}
                  {unread &&
                    ` · ${tr('header.sweepWaiting', {
                      count: task.waiting,
                      formatted: formatCount(task.waiting, i18n.language),
                    })}`}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
