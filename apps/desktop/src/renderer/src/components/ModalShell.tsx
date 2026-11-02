import type React from 'react'
import { createContext, useContext, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExitPresence } from '../hooks/useExitPresence'
import { lastInputWasKeyboard } from '../lib/inputModality'
import { useFocusTrap } from './useFocusTrap'

// Shorter than the 220 ms entrance and accelerating out: leaving needs no ceremony.
// .animate-pop-out in index.css runs for the same time.
export const MODAL_EXIT_MS = 150

const ModalLeaving = createContext(false)

// Keeps a dialog on screen for its exit after the condition that rendered it goes false, the
// way useExitPresence does for the toasts and the player, so a dialog leaves along the path it
// came in on instead of vanishing in one frame. Wrap the conditional itself:
// <ModalExit>{open && <SomeModal />}</ModalExit>.
export function ModalExit({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const present = Boolean(children)
  const last = useRef(children)
  if (present) last.current = children
  const { mounted, leaving } = useExitPresence(present, MODAL_EXIT_MS)
  if (!mounted) return null
  return <ModalLeaving value={leaving}>{present ? children : last.current}</ModalLeaving>
}

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
  // Skips the entrance animation (dialog pop and backdrop fade). For surfaces opened
  // many times a day — the command palette — where paying an entrance on every open
  // makes the app feel slower than it is. Card dialogs keep the default, except when a
  // key opened them: a keystroke expects its answer on the next frame.
  instant?: boolean
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
  instant = false,
  children,
}: Props): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [keyed] = useState(lastInputWasKeyboard)
  const bare = instant || keyed
  const leaving = useContext(ModalLeaving)
  // The trap lets go as the exit starts, not when it ends: the app behind is live and focus is
  // back on the trigger from the first frame, so the exit never costs a click or a keystroke.
  useFocusTrap(dialogRef, !leaving)
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
  // A key closed it, or it is a surface that opens bare: the answer is the next frame.
  if (leaving && (instant || lastInputWasKeyboard())) return null
  return (
    <div
      inert={leaving}
      className={`fixed inset-0 z-50 flex justify-center ${
        align === 'top' ? 'items-start pt-[8vh]' : 'items-center'
      }${leaving ? ' pointer-events-none' : ''}`}
    >
      <button
        type="button"
        data-testid={backdropTestId}
        aria-label={tr('common.close')}
        onClick={onClose}
        className={`${leaving ? 'animate-overlay-out ' : bare ? '' : 'animate-overlay '}absolute inset-0 bg-scrim/60 backdrop-blur-sm`}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        data-testid={dialogTestId}
        aria-labelledby={labelledBy}
        aria-label={label}
        className={`${leaving ? 'animate-pop-out ' : bare ? '' : 'animate-pop '}relative z-10 ${className}`}
      >
        {body}
      </div>
    </div>
  )
}
