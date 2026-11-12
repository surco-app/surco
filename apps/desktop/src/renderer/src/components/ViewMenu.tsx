import { Check } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

export interface ViewMenuItem {
  id: string
  label: string
  checked: boolean
  onToggle: () => void
}

export function ViewMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number
  y: number
  label: string
  items: ViewMenuItem[]
  onClose: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const firstRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    firstRef.current?.focus()
    return () => opener?.focus?.()
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        data-testid="view-menu-backdrop"
        aria-label={tr('common.close')}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
        className="absolute inset-0"
      />
      <div
        role="menu"
        aria-label={label}
        data-testid="view-menu"
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
        style={{ top: y, left: x }}
        className="animate-pop-flat absolute min-w-[200px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
      >
        {items.map((item, i) => (
          <button
            key={item.id}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            role="menuitemcheckbox"
            aria-checked={item.checked}
            data-testid={`view-menu-${item.id}`}
            onClick={() => {
              onClose()
              item.onToggle()
            }}
            className="flex w-full items-center gap-2 rounded py-1.5 pr-3 pl-2 text-left text-sm text-fg hover:bg-[var(--color-hover)]"
          >
            <Check
              aria-hidden="true"
              className={`h-3.5 w-3.5 shrink-0 ${item.checked ? '' : 'invisible'}`}
            />
            {item.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
