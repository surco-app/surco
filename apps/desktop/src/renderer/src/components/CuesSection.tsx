import { useQueryClient } from '@tanstack/react-query'
import type React from 'react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { activeCueFlow, MY_FLOW_ID } from '../../../shared/cueFlows'
import { MAX_HOT_CUES } from '../../../shared/cueRules'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import { useQueuedCues, useTrackCues } from '../hooks/useTrackCues'
import {
  type CueDraft,
  type DraftAction,
  type DraftCue,
  freeLetters,
  reduceDraft,
  startDraft,
  wantedOfDraft,
} from '../lib/cueDraft'
import { flowName } from '../lib/cueFlowName'
import { cueLetter } from '../lib/rowCues'
import { useAppSettings } from '../lib/settingsContext'
import { CuePalette } from './CuePalette'
import { CueWave } from './CueWave'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'

interface CueTarget {
  contentId: string
  path: string
  label: string
}

const MENU_ITEM =
  'block w-full whitespace-nowrap px-3 py-1 text-left hover:bg-[var(--color-hover)] disabled:opacity-40'

function Editing({
  read,
  queued,
  cue,
  onDiscard,
}: {
  read: TrackCues
  queued: QueuedCues | null
  cue: CueTarget
  onDiscard: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppSettings()
  const flows = settings.cueFlows
  const active = activeCueFlow(settings)
  const ctx = useMemo(
    () => ({
      beats: read.grid.map((b) => b.ms),
      strong: read.strong,
      phrases: read.phrases,
      flows,
    }),
    [read, flows],
  )
  const inRekordbox = useMemo(
    () => read.cues.map(({ id, ms, kind, color }) => ({ id, ms, kind, color })),
    [read],
  )
  const fresh = queued !== null && queued.fingerprint === read.fingerprint
  const baseline = fresh ? queued.wanted : inRekordbox
  const [state, dispatch] = useReducer(
    (s: CueDraft, a: DraftAction) => reduceDraft(s, a, ctx),
    undefined,
    () =>
      startDraft(
        baseline,
        active.id,
        read.cues.filter((c) => c.loop).map((c) => c.id),
      ),
  )
  const [menu, setMenu] = useState<{ ms: number; x: number; y: number } | null>(null)
  const [chosen, setChosen] = useState(state.flowId)
  const shownFlow = flows.some((f) => f.id === chosen) ? chosen : MY_FLOW_ID
  const openedWith = useRef(active.id)
  useEffect(() => {
    if (openedWith.current === active.id) return
    openedWith.current = active.id
    setChosen(active.id)
    dispatch({ type: 'use-flow', flowId: active.id })
  }, [active.id])
  const menuRef = useRef<HTMLDivElement>(null)
  const wanted = wantedOfDraft(state.cues)
  const unchanged = JSON.stringify(wanted) === JSON.stringify(baseline)
  const pending = (c: DraftCue): boolean =>
    !inRekordbox.some(
      (r) => r.id === c.id && r.ms === c.ms && r.kind === c.kind && r.color === c.color,
    )
  const selected = state.cues.find((c) => c.key === state.selected)
  const refreshQueued = () => queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] })
  useEffect(() => {
    if (menu === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menu])
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
      e.preventDefault()
      dispatch({ type: 'remove', key: selected.key })
    } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      dispatch({ type: 'undo' })
    }
  }
  const fromMenu = (action: DraftAction) => {
    dispatch(action)
    setMenu(null)
  }
  const letters = selected ? freeLetters(state.cues, selected.kind) : []
  return (
    <fieldset
      data-testid="cues-editor"
      aria-label={tr('editor.cues.title')}
      className="relative m-0 min-w-0 border-0 p-0"
      onKeyDown={onKey}
    >
      <CueWave
        wave={read.wave}
        grid={read.grid}
        durationMs={read.durationMs}
        cues={state.cues.map((c) => ({
          ...c,
          pending: pending(c),
          locked: state.locked.includes(c.key),
        }))}
        selected={state.selected}
        trimmed={state.trimmed}
        onMarkDrop={(ms) => dispatch({ type: 'mark-drop', ms })}
        onUnmarkDrop={(key) => dispatch({ type: 'unmark-drop', key })}
        onSelect={(key) => dispatch({ type: 'select', key })}
        onMove={(key, ms) => dispatch({ type: 'move', key, ms })}
        onMenu={setMenu}
      />
      {menu !== null && (
        <div
          ref={menuRef}
          data-testid="cues-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          className="absolute z-20 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 text-xs shadow-[var(--shadow-float)]"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="cues-menu-add-hot"
            disabled={state.cues.filter((c) => c.kind !== 0).length >= MAX_HOT_CUES}
            onClick={() => fromMenu({ type: 'add-hot', ms: menu.ms })}
            className={MENU_ITEM}
          >
            {tr('editor.cues.menuAddHot')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="cues-menu-add-call"
            onClick={() => fromMenu({ type: 'add-call', ms: menu.ms })}
            className={MENU_ITEM}
          >
            {tr('editor.cues.menuAddCall')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="cues-menu-mark-drop"
            onClick={() => fromMenu({ type: 'mark-drop', ms: menu.ms })}
            className={MENU_ITEM}
          >
            {tr('editor.cues.menuMarkDrop')}
          </button>
        </div>
      )}
      {selected && (
        <div
          data-testid="cues-selection"
          className="mt-2 flex flex-wrap items-center gap-3 text-xs"
        >
          <span className="font-medium">
            {selected.kind === 0
              ? tr('editor.cues.selectedCall')
              : tr('editor.cues.selectedHot', { letter: cueLetter(selected.kind) })}
          </span>
          {state.locked.includes(selected.key) && (
            <span data-testid="cues-loop" className="text-fg-dim">
              {tr('editor.cues.loop')}
            </span>
          )}
          {selected.kind !== 0 && !state.locked.includes(selected.key) && (
            <>
              <CuePalette
                value={selected.color}
                onPick={(color) => dispatch({ type: 'recolour', key: selected.key, color })}
                label={(index) => tr('editor.cues.colour', { index })}
              />
              <select
                data-testid="cues-letter"
                aria-label={tr('editor.cues.letter')}
                value={selected.kind}
                onChange={(e) =>
                  dispatch({ type: 'reletter', key: selected.key, kind: Number(e.target.value) })
                }
                className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2 py-1"
              >
                {(letters.includes(selected.kind) ? letters : [selected.kind, ...letters]).map(
                  (kind) => (
                    <option key={kind} value={kind}>
                      {cueLetter(kind)}
                    </option>
                  ),
                )}
              </select>
            </>
          )}
          {!state.locked.includes(selected.key) && (
            <button
              type="button"
              data-testid="cues-delete"
              onClick={() => dispatch({ type: 'remove', key: selected.key })}
              className="press whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] px-3 py-1 hover:bg-[var(--color-hover)]"
            >
              {tr('editor.cues.delete')}
            </button>
          )}
        </div>
      )}
      {queued !== null && !fresh && (
        <p data-testid="cues-queued-stale" className="mt-2 text-xs text-warn">
          {tr('editor.cues.queuedStale')}
        </p>
      )}
      {state.notice === 'manual' && (
        <p data-testid="cues-manual" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.manual')}
        </p>
      )}
      {state.notice === 'too-many' && (
        <p data-testid="cues-too-many" className="mt-2 text-xs text-warn">
          {tr('editor.cues.tooMany')}
        </p>
      )}
      {state.trimmed.length > 0 && (
        <p data-testid="cues-trimmed" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.trimmed', { count: state.trimmed.length })}
        </p>
      )}
      <div data-testid="cues-actions" className="mt-3 flex flex-wrap items-center gap-3">
        <select
          data-testid="cues-flow"
          aria-label={tr('editor.cues.flow')}
          value={shownFlow}
          onChange={(e) => setChosen(e.target.value)}
          className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2 py-1.5 text-xs"
        >
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {flowName(f, tr)}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="cues-apply-flow"
          onClick={() => dispatch({ type: 'apply-flow', flowId: shownFlow })}
          className="press whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs hover:bg-[var(--color-hover)]"
        >
          {tr('editor.cues.applyFlow')}
        </button>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            data-testid="cues-undo"
            disabled={unchanged && queued === null}
            onClick={onDiscard}
            className="press whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs hover:bg-[var(--color-hover)] disabled:opacity-40"
          >
            {tr('editor.cues.discard')}
          </button>
          <button
            type="button"
            data-testid="cues-save"
            disabled={unchanged}
            onClick={() => {
              void window.api
                .saveRekordboxCues({
                  contentId: cue.contentId,
                  path: cue.path,
                  label: cue.label,
                  wanted,
                  fingerprint: read.fingerprint,
                })
                .then(refreshQueued)
            }}
            className="press whitespace-nowrap rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          >
            {tr('editor.cues.save')}
          </button>
        </div>
      </div>
    </fieldset>
  )
}

export function CuesSection({
  cue,
  open,
  onToggle,
}: {
  cue: CueTarget
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const { data: read, isError } = useTrackCues(cue.contentId)
  const { data: queued } = useQueuedCues(cue.contentId)
  const [round, setRound] = useState(0)
  return (
    <div data-testid="cues-section" className="mt-6 border-t border-[var(--color-line)] pt-6">
      <SectionHeader
        sectionId="cues"
        title={tr('editor.cues.title')}
        open={open}
        onToggle={onToggle}
        help={tr('editor.cues.help')}
      />
      <SectionBody open={open}>
        <div className="mt-3">
          {isError || read === null ? (
            <p data-testid="cues-unreadable" className="text-xs text-fg-dim">
              {tr('editor.cues.unreadable')}
            </p>
          ) : read === undefined || queued === undefined ? null : !read.analysed ||
            read.grid.length === 0 ? (
            <p data-testid="cues-unanalysed" className="text-xs text-fg-dim">
              {tr('editor.cues.unanalysed')}
            </p>
          ) : (
            <Editing
              key={`${read.fingerprint}|${JSON.stringify(queued)}|${round}`}
              read={read}
              queued={queued}
              cue={cue}
              onDiscard={() => {
                setRound((n) => n + 1)
                if (queued !== null)
                  void window.api
                    .undoRekordboxCues(cue.contentId)
                    .then(() =>
                      queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] }),
                    )
              }}
            />
          )}
        </div>
      </SectionBody>
    </div>
  )
}
