import type React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFocusTrap } from './useFocusTrap'

interface Props {
  onClose: () => void
  // Each dialog keeps its own backdrop testid so existing tests/selectors stay stable.
  backdropTestId: string
  // Optional testid on the dialog box itself, for dialogs that are asserted directly.
  dialogTestId?: string
  // The dialog box classes (width, max-height, flex) — the shell adds animation/stacking.
  className: string
  // id of the heading the caller renders, wired to aria-labelledby so the dialog is named.
  labelledBy?: string
  label?: string
  align?: 'center' | 'top'
  // When set, the body is wrapped in a form so Enter submits via the primary button.
  onSubmit?: () => void
  children: React.ReactNode
}

// The shared shell for the app's card dialogs: a click-to-dismiss backdrop (a real
// <button> so it's reachable by keyboard and screen readers), the role="dialog" box with
// aria-modal and focus trapping, and optional form submission. Callers supply the heading
// (passing its id as labelledBy) and the body, so every dialog gets the same a11y wiring
// without repeating the boilerplate — and new dialogs inherit it for free.
export function ModalShell({
  onClose,
  backdropTestId,
  dialogTestId,
  className,
  labelledBy,
  label,
  align = 'center',
  onSubmit,
  children,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)
  const body = onSubmit ? (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {children}
    </form>
  ) : (
    children
  )
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center ${
        align === 'top' ? 'items-start pt-[8vh]' : 'items-center'
      }`}
    >
      <button
        type="button"
        data-testid={backdropTestId}
        aria-label={tr('common.close')}
        onClick={onClose}
        className="animate-overlay absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        data-testid={dialogTestId}
        aria-labelledby={labelledBy}
        aria-label={label}
        className={`animate-pop relative z-10 ${className}`}
      >
        {body}
      </div>
    </div>
  )
}
