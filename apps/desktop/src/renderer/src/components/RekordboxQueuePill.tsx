import { Clock } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RekordboxQueueState } from '../../../shared/types'
import {
  partText,
  pillText,
  type QueueWords,
  REKORDBOX_QUEUE_WORDS,
} from '../lib/rekordboxQueueText'

export function RekordboxQueuePill({
  state,
  onApplyNow,
  onDiscard,
  words = REKORDBOX_QUEUE_WORDS,
  testid = 'rekordbox-queue',
}: {
  state: RekordboxQueueState
  onApplyNow: () => void
  onDiscard: () => void
  words?: QueueWords
  testid?: string
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
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

  const text = pillText(tr, state, words)
  const hidden = !text
  useEffect(() => {
    if (!hidden) return
    setOpen(false)
    setConfirming(false)
  }, [hidden])
  if (!text) return null
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid={`${testid}-pill`}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
          setConfirming(false)
        }}
        className="press flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] px-2.5 py-1 text-xs text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
      >
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {text}
      </button>
      {open && (
        <div
          data-testid={`${testid}-menu`}
          className="absolute top-full right-0 z-30 mt-1.5 w-80 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-2 shadow-[var(--shadow-float)]"
        >
          {state.halted && (
            <p data-testid={`${testid}-halted`} className="mb-2 px-1.5 text-xs text-danger">
              {tr(words.halted)}
            </p>
          )}
          {state.elsewhere !== undefined && (
            <p data-testid={`${testid}-elsewhere`} className="mb-2 px-1.5 text-xs text-fg-muted">
              {tr(words.elsewhere, { count: state.elsewhere })}
            </p>
          )}
          <ul className="max-h-64 space-y-1 overflow-auto">
            {state.items.map((item) => (
              <li
                key={item.key}
                data-testid={`${testid}-item-${item.key}`}
                className="rounded px-1.5 py-1 text-xs"
              >
                <span className="block truncate text-fg">{item.label}</span>
                <span className="block truncate text-fg-faint">
                  {item.parts.map((p) => partText(tr, p)).join(', ')}
                </span>
              </li>
            ))}
          </ul>
          {confirming ? (
            <div className="mt-2 border-t border-[var(--color-line)] pt-2 text-xs">
              <p className="mb-2 text-fg-muted">{tr(words.discardConfirm)}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  data-testid={`${testid}-discard-no`}
                  onClick={() => setConfirming(false)}
                  className="rounded px-2 py-1 text-fg-muted hover:bg-[var(--color-hover)]"
                >
                  {tr('rekordboxQueue.discardNo')}
                </button>
                <button
                  type="button"
                  data-testid={`${testid}-discard-yes`}
                  onClick={() => {
                    setOpen(false)
                    setConfirming(false)
                    onDiscard()
                  }}
                  className="rounded px-2 py-1 text-danger hover:bg-[var(--color-hover)]"
                >
                  {tr('rekordboxQueue.discardYes')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex justify-end gap-2 border-t border-[var(--color-line)] pt-2 text-xs">
              <button
                type="button"
                data-testid={`${testid}-discard`}
                onClick={() => setConfirming(true)}
                className="rounded px-2 py-1 text-fg-muted hover:bg-[var(--color-hover)]"
              >
                {tr('rekordboxQueue.discard')}
              </button>
              {state.items.length > 0 && (
                <button
                  type="button"
                  data-testid={`${testid}-apply`}
                  onClick={() => {
                    setOpen(false)
                    onApplyNow()
                  }}
                  className="rounded bg-[var(--color-accent-soft)] px-2 py-1 text-fg hover:bg-[var(--color-hover)]"
                >
                  {tr('rekordboxQueue.applyNow')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
