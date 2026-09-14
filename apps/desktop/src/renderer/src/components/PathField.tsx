import type React from 'react'
import { useTranslation } from 'react-i18next'

// A read-only path with its own Change button, joined into one control.
//
// The three collection/folder pickers each drew a separate input and a detached button
// beside it, which read as two unrelated controls with a gap between them — and the gap
// grew with the panel. Joining them says what they are: one field, whose value is chosen
// rather than typed. The seam is a single shared border, so the pair keeps one outline
// like the search box does with its shortcut hint.
//
// Not an <input>: nothing can be typed here, and as an input it took a caret on click and
// then scrolled the text sideways to reveal the end — hiding the start of the path on top
// of the truncation already clipping it. A plain element cannot be focused or scrolled,
// and `title` still carries the whole path for anyone who needs to read it.
export function PathField({
  value,
  onChange,
  testid,
  emptyLabel,
  ariaLabel,
}: {
  value: string
  // Receives the path the picker returned; the dialog itself belongs to the caller, which
  // knows what kind of file it is asking for.
  onChange: () => void
  testid: string
  // Shown in place of a path when none is set, so the field says what it needs instead of
  // reading as an empty box.
  emptyLabel?: string
  // For a field with no visible label of its own — the output folder hangs under a
  // destination radio — so a screen reader still has a name to read.
  ariaLabel?: string
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="flex rounded-lg border border-[var(--color-line)] bg-[var(--color-field)]">
      <div
        id={testid}
        data-testid={testid}
        title={value}
        // A plain <div> takes no accessible name, so the one field with no visible label
        // of its own (the output folder, which hangs under a destination radio) needs a
        // role that does. group is honest here: it is a value, not a control.
        {...(ariaLabel ? { role: 'group', 'aria-label': ariaLabel } : {})}
        className={`min-w-0 flex-1 truncate px-3 py-2 text-sm ${
          value ? 'text-fg-muted' : 'text-fg-faint'
        }`}
      >
        {value || emptyLabel}
      </div>
      <button
        type="button"
        data-testid={`${testid}-change`}
        onClick={onChange}
        // The divider is the field's own border, so the two halves share one outline
        // instead of stacking a second one against it.
        className="press shrink-0 rounded-r-lg border-[var(--color-line)] border-l px-3 py-2 text-sm text-fg-muted hover:bg-[var(--color-line)] hover:text-fg"
      >
        {tr('common.change')}
      </button>
    </div>
  )
}
