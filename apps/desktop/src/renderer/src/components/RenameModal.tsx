import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CustomField, TrackMetadata } from '../../../shared/types'
import { groupOfField, labeledFields } from '../lib/fields'
import { insertToken } from '../lib/insertToken'
import { renderOutputName } from '../lib/outputName'
import { ModalShell } from './ModalShell'
import { Tooltip } from './Tooltip'

interface Props {
  meta: TrackMetadata
  initialFormat: string
  extension: string
  customFields: readonly CustomField[]
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
  customFields,
  onApply,
  onClose,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [format, setFormat] = useState(initialFormat)
  const [moreOpen, setMoreOpen] = useState(false)
  const formatRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = formatRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const preview = renderOutputName(format, meta)

  const fields = labeledFields(customFields, tr)
  const customKeys = new Set(customFields.map((f) => f.key))
  const where = (f: { key: string }): string =>
    customKeys.has(f.key) ? 'custom' : (groupOfField(f.key) ?? 'catalog')
  const pick = (id: string): { key: string; label: string }[] =>
    fields.filter((f) => where(f) === id)
  const rare = pick('catalog')
  const sections = [
    { id: 'identity', label: tr('fields.groupIdentity'), fields: pick('identity') },
    { id: 'order', label: tr('fields.groupOrder'), fields: pick('order') },
    { id: 'dj', label: tr('fields.groupDj'), fields: pick('dj') },
    { id: 'custom', label: tr('fields.groupCustom'), fields: pick('custom') },
    ...(moreOpen ? [{ id: 'catalog', label: tr('fields.groupCatalog'), fields: rare }] : []),
  ].filter((section) => section.fields.length > 0)

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
    <ModalShell
      onClose={onClose}
      backdropTestId="rename-backdrop"
      labelledBy="rename-title"
      className="w-[560px] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      onSubmit={apply}
    >
      <div className="-mx-6 -mt-6 mb-4 border-b border-[var(--color-line)] px-6 pt-5 pb-3">
        <h2 id="rename-title" className="text-base font-semibold">
          {tr('rename.title')}
        </h2>
      </div>

      <input
        ref={formatRef}
        data-testid="rename-format"
        aria-label={tr('settings.filenameFormat')}
        value={format}
        onChange={(e) => setFormat(e.target.value)}
        placeholder="{artist} - {title}"
        spellCheck={false}
        className="w-full rounded-lg border border-[var(--color-input-border)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
      <p className="mt-2.5 mb-1.5 text-xs text-fg-dim">{tr('settings.insertToken')}</p>
      {sections.map(({ id, label, fields }) => (
        <div key={id}>
          <p
            data-testid={`rename-group-${id}`}
            className="mt-2 mb-1 text-[11px] font-medium text-fg-faint"
          >
            {label}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {fields.map((f) => (
              <button
                key={f.key}
                type="button"
                data-testid={`rename-token-${f.key}`}
                onClick={() => addToken(f.key)}
                className="press group relative rounded-full border border-[var(--color-line-strong)] px-2.5 py-0.5 text-[11px] text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
              >
                {f.label}
                <Tooltip label={`{${f.key}}`} />
              </button>
            ))}
          </div>
        </div>
      ))}
      {rare.length > 0 && (
        <button
          type="button"
          data-testid="rename-more-fields"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          className="press mt-2.5 rounded-full border border-dashed border-[var(--color-line-strong)] px-2.5 py-0.5 text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
        >
          {moreOpen ? tr('rename.fewerFields') : tr('rename.moreFields', { count: rare.length })}
        </button>
      )}
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
          className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-hover)]"
        >
          {tr('common.cancel')}
        </button>
        <button
          type="submit"
          data-testid="rename-apply"
          disabled={!preview}
          className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
        >
          {tr('rename.apply')}
        </button>
      </div>
    </ModalShell>
  )
}
