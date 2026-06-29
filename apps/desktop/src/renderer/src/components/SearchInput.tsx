import { Loader2, Search, X } from 'lucide-react'
import type React from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  placeholder: string
  ariaLabel: string
  clearLabel: string
  testid: string
  // While a remote search is in flight the magnifier becomes a spinner — this carries
  // the loading feedback that used to live on a separate "Search" button.
  busy?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  // Lets the caller stretch the field in a flex row (the Discogs column wants flex-1).
  className?: string
}

// The shared search field used by both the track-list filter and the Discogs box, so the
// two columns read as one toolbar: a leading magnifier, a clear-X that appears once there
// is text, and the same field chrome.
export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder,
  ariaLabel,
  clearLabel,
  testid,
  busy = false,
  inputRef,
  onKeyDown,
  className = '',
}: Props): React.JSX.Element {
  return (
    <div className={`relative ${className}`}>
      {busy ? (
        <Loader2
          data-testid={`${testid}-spinner`}
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-fg-faint"
          aria-hidden="true"
        />
      ) : (
        <Search
          data-testid={`${testid}-icon`}
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
          aria-hidden="true"
        />
      )}
      <input
        ref={inputRef}
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-field)] pl-7 pr-7 text-xs outline-none focus:border-[var(--color-accent)]"
      />
      {value && (
        <button
          type="button"
          data-testid={`${testid}-clear`}
          aria-label={clearLabel}
          onClick={onClear}
          className="press absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-faint hover:text-fg"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
