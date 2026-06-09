import { ChevronDown, X } from 'lucide-react'
import type React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFocusTrap } from './useFocusTrap'

interface Props {
  onClose: () => void
}

const ITEMS = ['token', 'quality', 'format', 'appleMusic'] as const

export function HelpModal({ onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState<string | null>(ITEMS[0])
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        data-testid="help-backdrop"
        aria-label={tr('common.close')}
        onClick={onClose}
        className="animate-overlay absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="animate-pop relative z-10 flex max-h-[80vh] w-[560px] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
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
          {ITEMS.map((id) => {
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
      </div>
    </div>
  )
}
