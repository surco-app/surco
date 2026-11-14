import type React from 'react'
import { useId } from 'react'
import type { DjProgram } from '../../../shared/djProgram'

type IconProps = { size: number; 'data-testid'?: string }

// The note from Apple Music's app icon, lifted out of its tile (Simple Icons' outline, CC0)
// so it can take the rail's text colour like the lucide icons beside it.
export function AppleMusicIcon({ size, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="1.85 2.53 18.58 18.58" width={size} height={size} aria-hidden="true" {...rest}>
      <path
        fill="currentColor"
        d="M17.571 10.114v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.045-1.773-.6-1.943-1.536a1.88 1.88 0 011.038-2.022c.323-.16.67-.25 1.018-.324.378-.082.758-.153 1.134-.24.274-.063.457-.23.51-.516a.904.904 0 00.02-.193c0-1.815 0-3.63-.002-5.443a.725.725 0 00-.026-.185c-.04-.15-.15-.243-.304-.234-.16.01-.318.035-.475.066-.76.15-1.52.303-2.28.456l-2.325.47-1.374.278c-.016.003-.032.01-.048.013-.277.077-.377.203-.39.49-.002.042 0 .086 0 .13-.002 2.602 0 5.204-.003 7.805 0 .42-.047.836-.215 1.227-.278.64-.77 1.04-1.434 1.233-.35.1-.71.16-1.075.172-.96.036-1.755-.6-1.92-1.544-.14-.812.23-1.685 1.154-2.075.357-.15.73-.232 1.108-.31.287-.06.575-.116.86-.177.383-.083.583-.323.6-.714v-.15c0-2.96 0-5.922.002-8.882 0-.123.013-.25.042-.37.07-.285.273-.448.546-.518.255-.066.515-.112.774-.165.733-.15 1.466-.296 2.2-.444l2.27-.46c.67-.134 1.34-.27 2.01-.403.22-.043.442-.088.663-.106.31-.025.523.17.554.482.008.073.012.148.012.223.002 1.91.002 3.822 0 5.732z"
      />
    </svg>
  )
}

// rekordbox's mark redrawn from its app icon: a cube whose three front edges and a ring
// around the centre are cut away. A mask does the cutting so the mark stays one colour.
// The id is per instance; two rails on screen must not share one mask.
export function RekordboxIcon({ size, ...rest }: IconProps): React.JSX.Element {
  const mask = useId()
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...rest}>
      <mask id={mask}>
        <g transform="translate(12 12) scale(1.06) translate(-12 -12)">
          <polygon
            points="12,2.4 20.31,7.2 20.31,16.8 12,21.6 3.69,16.8 3.69,7.2"
            fill="white"
            stroke="white"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M12 12V24M12 12L1.61 6M12 12L22.39 6" stroke="black" strokeWidth="2.3" />
          <circle cx="12" cy="12" r="4.4" fill="none" stroke="black" strokeWidth="2.9" />
          <circle cx="12" cy="12" r="2.95" fill="white" />
        </g>
      </mask>
      <rect width="24" height="24" fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  )
}

export function EngineIcon({ size, ...rest }: IconProps): React.JSX.Element {
  const mask = useId()
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...rest}>
      <mask id={mask}>
        <circle cx="12" cy="12" r="10" fill="white" />
        <rect x="10" y="7.6" width="14" height="2.6" fill="black" />
        <rect x="10" y="13.8" width="14" height="2.6" fill="black" />
      </mask>
      <rect width="24" height="24" fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  )
}

// Traktor's mark redrawn from its app icon: a disc with the T cut out of it.
export function TraktorIcon({ size, ...rest }: IconProps): React.JSX.Element {
  const mask = useId()
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...rest}>
      <mask id={mask}>
        <circle cx="12" cy="12" r="10" fill="white" />
        <rect x="6.5" y="6.8" width="11" height="2.8" fill="black" />
        <rect x="10.6" y="6.8" width="2.8" height="10.4" fill="black" />
      </mask>
      <rect width="24" height="24" fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  )
}

export function SeratoIcon({ size, ...rest }: IconProps): React.JSX.Element {
  const mask = useId()
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...rest}>
      <mask id={mask}>
        <circle cx="12" cy="12" r="10" fill="white" />
        <path
          d="M15.4 8.4C14.4 7.2 8.9 6.9 8.9 9.6C8.9 12.1 15.1 11.9 15.1 14.4C15.1 17.1 9.6 16.8 8.6 15.6"
          fill="none"
          stroke="black"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </mask>
      <rect width="24" height="24" fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  )
}

export function VirtualdjIcon({ size, ...rest }: IconProps): React.JSX.Element {
  const mask = useId()
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...rest}>
      <mask id={mask}>
        <circle cx="12" cy="12" r="10" fill="white" />
        <path
          d="M7.6 7.6L12 16.6L16.4 7.6"
          fill="none"
          stroke="black"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
      <rect width="24" height="24" fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  )
}

export const LIBRARY_ICON: Record<DjProgram, (props: IconProps) => React.JSX.Element> = {
  rekordbox: RekordboxIcon,
  traktor: TraktorIcon,
  engine: EngineIcon,
  serato: SeratoIcon,
  virtualdj: VirtualdjIcon,
}

export function MatchingIcon({
  size,
  className,
  ...rest
}: IconProps & { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 14"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <circle cx="5.5" cy="7" r="4" />
      <circle cx="10.5" cy="7" r="4" />
    </svg>
  )
}
