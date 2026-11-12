import { Ellipsis, type LucideIcon } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { SPLIT_ITEM, useSplitMenu } from './SplitButton'
import { Tooltip } from './Tooltip'

export interface MetaMenuItem {
  id: string
  testid: string
  label: string
  Icon: LucideIcon
  onSelect: () => void
  disabled?: boolean
  separatorBefore?: boolean
}

const MENU =
  'animate-pop-flat absolute right-0 top-full z-50 mt-1 w-64 origin-top-right overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] py-1 shadow-[var(--shadow-float)]'

export function MetaMoreMenu({ items }: { items: MetaMenuItem[] }): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const { open, setOpen, ref, toggleRef, menuRef, onMenuKeyDown } = useSplitMenu()
  if (items.length === 0) return null
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        data-testid="meta-more"
        ref={toggleRef}
        aria-label={tr('editor.moreActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="press group relative flex h-7 w-7 items-center justify-center rounded-md text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg aria-expanded:bg-[var(--color-accent-soft)] aria-expanded:text-[var(--color-accent)]"
      >
        <Ellipsis className="h-3.5 w-3.5" aria-hidden="true" />
        <Tooltip label={tr('editor.moreActions')} align="end" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={tr('editor.moreActions')}
          onKeyDown={onMenuKeyDown}
          className={MENU}
        >
          {items.map(({ id, testid, label, Icon, onSelect, disabled, separatorBefore }) => (
            <button
              key={id}
              type="button"
              data-testid={testid}
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                setOpen(false)
                onSelect()
              }}
              className={`${SPLIT_ITEM} justify-start gap-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
                separatorBefore ? 'mt-1 border-t border-[var(--color-line)] pt-2.5' : ''
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-fg-dim" aria-hidden="true" />
              <span className="min-w-0 truncate">{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
