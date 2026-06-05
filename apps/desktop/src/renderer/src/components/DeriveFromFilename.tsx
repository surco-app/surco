import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../shared/types'
import { deriveTags } from '../lib/deriveTags'
import type { TrackItem } from '../types'

interface Props {
  files: TrackItem[]
  onApply: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
}

// Fills tags from the file name through a "{artist} - {title}"-style template — the rescue
// path for rips that carry their metadata only in the name. The preview shows what the first
// file would yield so the user can adjust the pattern before applying; applying derives each
// file from its own name and merges (never blanks) the fields it finds.
export function DeriveFromFilename({ files, onApply }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [pattern, setPattern] = useState('{artist} - {title}')
  const sample = files[0]
  const preview = sample ? deriveTags(sample.fileName, pattern) : {}
  const entries = Object.entries(preview)

  function apply(): void {
    const patches = files
      .map((f) => ({ id: f.id, meta: deriveTags(f.fileName, pattern) }))
      .filter((p) => Object.keys(p.meta).length > 0)
    if (patches.length) onApply(patches)
  }

  return (
    <div className="mt-6 border-t border-[var(--color-line)] pt-5" data-testid="derive-section">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-faint">
        {tr('derive.title')}
      </h3>
      <div className="flex gap-2">
        <input
          data-testid="derive-pattern"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="button"
          data-testid="derive-apply"
          onClick={apply}
          disabled={entries.length === 0}
          className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {files.length > 1 ? tr('derive.applyMany', { count: files.length }) : tr('derive.apply')}
        </button>
      </div>
      {sample && (
        <p className="mt-2 text-xs text-fg-dim">
          {entries.length > 0 ? (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {entries.map(([key, value]) => (
                <span key={key} data-testid={`derive-preview-${key}`}>
                  <span className="text-fg-faint">{tr(`fields.${key}`)} →</span> {value}
                </span>
              ))}
            </span>
          ) : (
            <span data-testid="derive-nomatch">{tr('derive.noMatch')}</span>
          )}
        </p>
      )}
    </div>
  )
}
