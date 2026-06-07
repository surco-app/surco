import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../shared/types'
import { FIELD_DEFS } from '../lib/fields'
import { insertToken } from '../lib/insertToken'
import { renderOutputName } from '../lib/outputName'
import { useFocusTrap } from './useFocusTrap'

interface Props {
  meta: TrackMetadata
  initialFormat: string
  extension: string
  onApply: (outputName: string) => void
  onClose: () => void
}

// A per-track version of the Settings "File name format" editor (Meta's "Rename Files"
// dialog): build a pattern from text + metadata chips, preview it against THIS track, and
// on apply write the rendered name into the output-name field. Editing here is scoped to
// the track — it never touches the global default in Settings.
export function RenameModal({
  meta,
  initialFormat,
  extension,
  onApply,
  onClose,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [format, setFormat] = useState(initialFormat)
  const dialogRef = useRef<HTMLDivElement>(null)
  const formatRef = useRef<HTMLInputElement>(null)
  useFocusTrap(dialogRef)

  useEffect(() => {
    const el = formatRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const preview = renderOutputName(format, meta)

  function addToken(key: string): void {
    const el = formatRef.current
    const start = el?.selectionStart ?? format.length
    const end = el?.selectionEnd ?? format.length
    const { value, caret } = insertToken(format, start, end, key)
    setFormat(value)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  function apply(): void {
    if (!preview) return
    onApply(preview)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        data-testid="rename-backdrop"
        aria-label={tr('common.close')}
        onClick={onClose}
        className="animate-overlay absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="animate-pop relative z-10 w-[560px] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      >
        <div className="-mx-6 -mt-6 mb-4 border-b border-[var(--color-line)] px-6 pt-5 pb-3">
          <h2 className="text-base font-semibold">{tr('rename.title')}</h2>
          <p className="mt-0.5 text-xs text-fg-dim">{tr('rename.description')}</p>
        </div>

        <input
          ref={formatRef}
          data-testid="rename-format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          placeholder="{artist} - {title}"
          spellCheck={false}
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <p className="mt-2.5 mb-1.5 text-xs text-fg-dim">{tr('settings.insertToken')}</p>
        <div className="flex flex-wrap gap-1.5">
          {FIELD_DEFS.map((f) => (
            <button
              key={f.key}
              type="button"
              data-testid={`rename-token-${f.key}`}
              onClick={() => addToken(f.key)}
              title={`{${f.key}}`}
              className="press rounded-full border border-[var(--color-line-strong)] px-2.5 py-0.5 text-[11px] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
            >
              {tr(`fields.${f.key}`)}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-fg-dim">
          {tr('settings.preview')}{' '}
          <span data-testid="rename-preview" className="font-mono text-fg-muted">
            {preview || '—'}.{extension}
          </span>
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="rename-cancel"
            onClick={onClose}
            className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-panel-2)]"
          >
            {tr('common.cancel')}
          </button>
          <button
            type="button"
            data-testid="rename-apply"
            onClick={apply}
            disabled={!preview}
            className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {tr('rename.apply')}
          </button>
        </div>
      </div>
    </div>
  )
}
