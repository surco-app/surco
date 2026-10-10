import type React from 'react'

export function CleanSpark({ className = 'h-3 w-3' }: { className?: string }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinejoin="round"
    >
      <path d="M6 .6Q6.7 5.3 11.4 6 6.7 6.7 6 11.4 5.3 6.7.6 6 5.3 5.3 6 .6Z" />
    </svg>
  )
}
