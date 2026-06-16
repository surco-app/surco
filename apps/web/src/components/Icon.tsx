import type { ReactNode } from 'react'

// Generic, monochrome line glyphs (no third-party brand logos), drawn inside a shared
// 24×24 stroke <svg>. One source of truth so the landing's icon language stays
// consistent across the "replaces", features and how-it-works sections.
const GLYPHS = {
  // swap / repeat arrows — conversion
  convert: (
    <>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  // a record — Discogs / pick a release
  disc: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  // a tag — metadata
  tag: (
    <>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h6l9 9-6 6-9-9v-4.5Z" />
      <circle cx="7.5" cy="9.5" r="1" />
    </>
  ),
  // ascending bars — spectrum / quality
  spectrum: (
    <>
      <line x1="6" y1="14" x2="6" y2="18" />
      <line x1="10" y1="9" x2="10" y2="18" />
      <line x1="14" y1="5" x2="14" y2="18" />
      <line x1="18" y1="11" x2="18" y2="18" />
    </>
  ),
  // a music note — Apple Music
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  // tray with a down arrow — drop / import
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  // tray with an up arrow — export
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 9 12 4 17 9" />
      <line x1="12" y1="4" x2="12" y2="16" />
    </>
  ),
  // a circled check — done
  check: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type GlyphName = keyof typeof GLYPHS

export default function Icon({
  name,
  className = '',
}: {
  name: GlyphName
  className?: string
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[name]}
    </svg>
  )
}
