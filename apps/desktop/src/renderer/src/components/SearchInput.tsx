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
  scope?: string
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
  scope,
}: Props): React.JSX.Element {
  const iconPlace = scope
    ? 'h-3 w-3 shrink-0'
    : 'pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2'
  const icon = busy ? (
    <Loader2
      data-testid={`${testid}-spinner`}
      className={`${iconPlace} animate-spin text-fg-faint`}
      aria-hidden="true"
    />
  ) : (
    <Search
      data-testid={`${testid}-icon`}
      className={`${iconPlace} text-fg-faint`}
      aria-hidden="true"
    />
  )
  const Frame = scope ? 'label' : 'div'
  return (
    <Frame
      className={
        scope
          ? `relative flex items-center rounded-lg bg-[var(--color-panel-2)]/60 focus-within:outline-2 focus-within:outline-[var(--color-accent)] ${className}`
          : `relative ${className}`
      }
    >
      {scope ? (
        <span
          data-testid={`${testid}-scope`}
          aria-hidden="true"
          className="ml-1 flex h-6 shrink-0 items-center gap-1 rounded-md bg-[var(--color-panel)] px-1.5 text-label font-medium text-fg-dim"
        >
          {icon}
          {scope}
        </span>
      ) : (
        icon
      )}
      <input
        ref={inputRef}
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
        placeholder={placeholder}
        // A soft fill and no border, like a macOS search field: the header is chrome around the
        // list, and a bordered box read as one more form control to fill in.
        className={
          scope
            ? 'h-8 min-w-0 flex-1 bg-transparent pl-2 pr-7 text-xs outline-none placeholder:text-fg-faint focus-visible:shadow-none'
            : 'h-8 w-full rounded-lg bg-[var(--color-panel-2)]/60 pl-7 pr-7 text-xs outline-none placeholder:text-fg-faint'
        }
      />
      {value && (
        <button
          type="button"
          data-testid={`${testid}-clear`}
          aria-label={clearLabel}
          onClick={onClear}
          className="press absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-faint after:absolute after:-inset-[3px] after:content-[''] hover:text-fg"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </Frame>
  )
}
