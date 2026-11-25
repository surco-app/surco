import { Check } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { menuItems, menuStep } from '../lib/menuStep'

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
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    })
  }, [x, y])

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
        ref={menuRef}
        role="menu"
        aria-label={label}
        data-testid="view-menu"
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
            return
          }
          const items = menuItems(menuRef.current, '[role^="menuitem"]')
          const next = menuStep(
            e.key,
            items.indexOf(document.activeElement as HTMLElement),
            items.length,
          )
          if (next === null || items.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          items[next].focus()
        }}
        style={{ top: pos.y, left: pos.x }}
        className="absolute min-w-[200px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
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
