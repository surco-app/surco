import { ChevronDown, X } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isMacOS, isWindows } from '../lib/platform'
import { ModalShell } from './ModalShell'

interface Props {
  onClose: () => void
}

const ITEMS = ['token', 'quality', 'format'] as const

export function HelpModal({ onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState<string | null>(ITEMS[0])
  // The Apple Music FAQ describes a macOS-only integration, so off macOS it would
  // document a feature the app doesn't offer; Windows instead gets an entry on
  // what differs there (no Apple Music, WAV tags invisible to Explorer).
  const items = [...ITEMS, ...(isMacOS() ? ['appleMusic'] : isWindows() ? ['windows'] : [])]

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="help-backdrop"
      labelledBy="help-title"
      className="flex max-h-[80vh] w-[560px] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
    >
      <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between border-b border-[var(--color-line)] px-6 pt-5 pb-3">
        <h2 id="help-title" className="text-base font-semibold">
          {tr('help.title')}
        </h2>
        <button
          type="button"
          data-testid="help-close"
          onClick={onClose}
          aria-label={tr('common.close')}
          className="press flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="-mx-2 overflow-y-auto px-2">
        {items.map((id) => {
          const isOpen = open === id
          return (
            <div key={id} className="border-b border-[var(--color-line)] last:border-b-0">
              <button
                type="button"
                data-testid={`help-q-${id}`}
                onClick={() => setOpen(isOpen ? null : id)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-medium hover:text-[var(--color-accent)]"
              >
                {tr(`help.items.${id}.q`)}
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 text-fg-muted transition-transform ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {isOpen && (
                <p className="whitespace-pre-line pb-4 text-sm leading-relaxed text-fg-dim">
                  {tr(`help.items.${id}.a`)}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </ModalShell>
  )
}
