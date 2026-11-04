import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  anchorNear,
  downbeatAt,
  type EditableGrid,
  editAt,
  fitGrid,
  GRID_BPM_MAX,
  GRID_BPM_MIN,
  type GridFit,
  retempoGrid,
  scaleGrid,
  shiftGrid,
  toggleAnchor,
  zoneAt,
} from '../../../shared/gridEdit'
import { formatFixed } from '../lib/numberFormat'

const GROUP = 'flex shrink-0 items-center gap-1'
const ICON =
  'press flex h-7 w-8 items-center justify-center rounded-md bg-[var(--color-panel-2)] text-fg-muted transition-colors enabled:hover:bg-[var(--color-hover)] hover:text-fg disabled:opacity-40'
const MENU_ITEM =
  'press flex h-7 items-center rounded-md px-2 text-left text-xs text-fg hover:bg-[var(--color-hover)] disabled:opacity-40 disabled:hover:bg-transparent'
const STEP_BPM = 0.01
const STEP_MS = 5
const FINE_STEP_MS = 1

const hundredths = (n: number): number => Math.round(n * 100) / 100

function parseBpm(typed: string): number | null {
  const value = Number(typed.trim().replace(',', '.'))
  if (!typed.trim() || !Number.isFinite(value)) return null
  return value >= GRID_BPM_MIN && value <= GRID_BPM_MAX ? hundredths(value) : null
}

type Arrow = 'in' | 'out'

function Bars({
  left,
  right,
  times,
}: {
  left?: Arrow
  right?: Arrow
  times?: string
}): React.JSX.Element {
  const width = times ? 24 : 22
  return (
    <svg width={width} height="12" viewBox={`0 0 ${width} 12`} aria-hidden="true">
      <path d="M8 1v10M11 1v10M14 1v10" stroke="currentColor" strokeWidth="1.3" />
      {left === 'in' && <path d="M1 6l4-3.5v7z" fill="currentColor" />}
      {left === 'out' && <path d="M5.5 6L1.5 2.5v7z" fill="currentColor" />}
      {right === 'out' && <path d="M21 6l-4-3.5v7z" fill="currentColor" />}
      {right === 'in' && <path d="M16.5 6l4-3.5v7z" fill="currentColor" />}
      {times && (
        <text x="16" y="10" fontSize="8" fontWeight="700" fill="currentColor">
          {times}
        </text>
      )}
    </svg>
  )
}

export function CueGridControls({
  grid,
  disabledReason,
  fit,
  needsFix,
  playheadMs,
  onChange,
  onFit,
  onDone,
  zones = true,
}: {
  grid: EditableGrid | null
  disabledReason: string | null
  fit: GridFit | null
  needsFix: boolean
  playheadMs: number
  onChange: (grid: EditableGrid) => void
  onFit: (grid: EditableGrid) => void
  onDone?: () => void
  zones?: boolean
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const [menu, setMenu] = useState(false)
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const menuRoot = useRef<HTMLDivElement>(null)
  const closeMenu = useRef(() => {})
  closeMenu.current = () => {
    setMenu(false)
    onDone?.()
  }
  useEffect(() => {
    if (!menu) return
    input.current?.select()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeMenu.current()
    }
    const onDown = (e: MouseEvent) => {
      if (!menuRoot.current?.contains(e.target as Node)) closeMenu.current()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menu])
  const off = disabledReason !== null || grid === null
  const bpm = grid ? zoneAt(grid, playheadMs).bpm : 0
  const inZone = (edit: (zone: EditableGrid) => EditableGrid | null): EditableGrid | null =>
    grid ? editAt(grid, playheadMs, edit) : null
  const retempo = (next: number): EditableGrid | null =>
    inZone((zone) => retempoGrid(zone, next, playheadMs))
  const scale = (factor: 2 | 0.5): EditableGrid | null => inZone((zone) => scaleGrid(zone, factor))
  const atAnchor = grid !== null && anchorNear(grid, playheadMs)
  const apply = (next: EditableGrid | null) => {
    if (next) onChange(next)
  }
  const shift = (dir: 1 | -1) => (e: React.MouseEvent) => {
    apply(inZone((zone) => shiftGrid(zone, dir * (e.shiftKey ? FINE_STEP_MS : STEP_MS))))
  }
  const toggleMenu = () => {
    if (menu) return closeMenu.current()
    setTyped(formatFixed(bpm, 2, i18n.language))
    setMenu(true)
  }
  const fromMenu = (next: EditableGrid | null) => {
    closeMenu.current()
    apply(next)
  }

  return (
    <div
      data-testid="cues-grid"
      aria-disabled={off}
      title={disabledReason ?? undefined}
      className="flex flex-wrap items-center gap-2"
    >
      <div ref={menuRoot} className="relative">
        <button
          type="button"
          data-testid="cues-grid-bpm"
          aria-label={tr('editor.cues.grid.bpm')}
          disabled={off}
          onClick={toggleMenu}
          className="press flex h-7 w-[62px] items-center justify-center rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] text-xs font-semibold tabular-nums text-fg disabled:opacity-40"
        >
          {grid ? formatFixed(bpm, 2, i18n.language) : '–'}
        </button>
        {menu && (
          <div
            data-testid="cues-grid-bpm-menu"
            className="absolute bottom-9 left-0 z-20 flex w-40 flex-col gap-0.5 rounded-lg bg-[var(--color-panel-2)] p-1.5 shadow-[var(--shadow-float)]"
          >
            <label className="flex flex-col gap-1 px-1 pb-1 text-xs text-fg-dim">
              {tr('editor.cues.grid.bpmHint')}
              <input
                data-testid="cues-grid-bpm-input"
                ref={input}
                inputMode="decimal"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') return
                  e.stopPropagation()
                  if (e.key !== 'Enter') return
                  const value = parseBpm(typed)
                  fromMenu(value === null ? null : retempo(value))
                }}
                className="h-7 rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] px-2 text-xs tabular-nums text-fg"
              />
            </label>
            <button
              type="button"
              data-testid="cues-grid-double"
              disabled={bpm * 2 > GRID_BPM_MAX}
              onClick={() => fromMenu(scale(2))}
              className={MENU_ITEM}
            >
              {tr('editor.cues.grid.double')}
            </button>
            <button
              type="button"
              data-testid="cues-grid-half"
              disabled={bpm / 2 < GRID_BPM_MIN}
              onClick={() => fromMenu(scale(0.5))}
              className={MENU_ITEM}
            >
              {tr('editor.cues.grid.half')}
            </button>
          </div>
        )}
      </div>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-[var(--color-line)]" />
      <div data-testid="cues-grid-move" className={GROUP}>
        <button
          type="button"
          data-testid="cues-grid-left"
          aria-label={tr('editor.cues.grid.left')}
          title={tr('editor.cues.grid.left')}
          disabled={off}
          onClick={shift(-1)}
          className={ICON}
        >
          <Bars left="in" />
        </button>
        <button
          type="button"
          data-testid="cues-grid-right"
          aria-label={tr('editor.cues.grid.right')}
          title={tr('editor.cues.grid.right')}
          disabled={off}
          onClick={shift(1)}
          className={ICON}
        >
          <Bars right="out" />
        </button>
      </div>
      <div data-testid="cues-grid-width" className={GROUP}>
        <button
          type="button"
          data-testid="cues-grid-widen"
          aria-label={tr('editor.cues.grid.widen')}
          title={tr('editor.cues.grid.widen')}
          disabled={off}
          onClick={() => apply(retempo(bpm - STEP_BPM))}
          className={ICON}
        >
          <Bars left="in" right="out" />
        </button>
        <button
          type="button"
          data-testid="cues-grid-narrow"
          aria-label={tr('editor.cues.grid.narrow')}
          title={tr('editor.cues.grid.narrow')}
          disabled={off}
          onClick={() => apply(retempo(bpm + STEP_BPM))}
          className={ICON}
        >
          <Bars left="out" right="in" />
        </button>
        <button
          type="button"
          data-testid="cues-grid-x2"
          aria-label={tr('editor.cues.grid.double')}
          title={tr('editor.cues.grid.double')}
          disabled={off || bpm * 2 > GRID_BPM_MAX}
          onClick={() => apply(scale(2))}
          className={ICON}
        >
          <Bars times="×2" />
        </button>
        <button
          type="button"
          data-testid="cues-grid-x05"
          aria-label={tr('editor.cues.grid.half')}
          title={tr('editor.cues.grid.half')}
          disabled={off || bpm / 2 < GRID_BPM_MIN}
          onClick={() => apply(scale(0.5))}
          className={ICON}
        >
          <Bars times="×½" />
        </button>
      </div>
      <div data-testid="cues-grid-mark" className={GROUP}>
        <button
          type="button"
          data-testid="cues-grid-downbeat"
          aria-label={tr('editor.cues.grid.downbeat')}
          title={tr('editor.cues.grid.downbeat')}
          disabled={off}
          onClick={() => apply(inZone((zone) => downbeatAt(zone, playheadMs)))}
          className={ICON}
        >
          <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
            <path d="M6.5 0h5L9 3z" fill="currentColor" />
            <path d="M3 5v9M15 5v9" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9 5v9" stroke="var(--color-danger)" strokeWidth="1.8" />
          </svg>
        </button>
        <button
          type="button"
          data-testid="cues-grid-anchor"
          aria-label={tr(atAnchor ? 'editor.cues.grid.anchorRemove' : 'editor.cues.grid.anchorAdd')}
          title={tr(atAnchor ? 'editor.cues.grid.anchorRemove' : 'editor.cues.grid.anchorAdd')}
          disabled={off || !zones}
          onClick={() => grid && onChange(toggleAnchor(grid, playheadMs))}
          className={ICON}
        >
          <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
            <path d="M3 1v12M15 1v12" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M9 13V2l5 2.5L9 7"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1.6"
            />
          </svg>
        </button>
      </div>
      <button
        type="button"
        data-testid="cues-grid-auto"
        data-needs-fix={needsFix && !off ? 'true' : undefined}
        title={tr('editor.cues.grid.autoHint')}
        disabled={off || fit === null}
        onClick={() => grid && fit && onFit(fitGrid(grid, fit, playheadMs))}
        className="press ml-1 flex h-7 items-center rounded-md border border-[var(--color-line-strong)] px-2 text-xs font-medium text-fg-muted transition-colors hover:bg-[var(--color-hover)] disabled:opacity-40 data-[needs-fix=true]:border-[var(--color-accent)] data-[needs-fix=true]:bg-[var(--color-accent)] data-[needs-fix=true]:font-semibold data-[needs-fix=true]:text-[var(--color-on-accent)]"
      >
        {tr('editor.cues.grid.auto')}
      </button>
    </div>
  )
}
