import type { TFunction } from 'i18next'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionWhy } from '../../../shared/sessionBuild'
import type { SessionTrack } from '../../../shared/sessionTypes'

interface Phrase {
  text: string
  tone: string
}

function phraseOf(why: SessionWhy, tr: TFunction): Phrase {
  switch (why.kind) {
    case 'combo':
      return {
        text: tr('sessions.why.combo', { count: why.sets }),
        tone: 'text-[var(--color-accent)]',
      }
    case 'harmonic': {
      const relation =
        why.distance === 0
          ? 'harmonicSame'
          : Number.parseInt(why.from, 10) === Number.parseInt(why.to, 10)
            ? 'harmonicRing'
            : 'harmonicNeighbour'
      return {
        text: tr(`sessions.why.${relation}`, { from: why.from, to: why.to }),
        tone: 'text-fg-dim',
      }
    }
    case 'taste':
      return {
        text: tr(why.rating > 0 ? 'sessions.why.tasteRated' : 'sessions.why.tastePlayed'),
        tone: 'text-warn',
      }
    case 'bpm':
      return {
        text: tr(why.relaxed ? 'sessions.why.bpmRelaxed' : 'sessions.why.bpm'),
        tone: why.relaxed ? 'text-warn' : 'text-fg-faint',
      }
    case 'fresh':
      return {
        text: why.key
          ? tr('sessions.why.freshKey', { key: why.key })
          : tr('sessions.why.freshTempo'),
        tone: 'text-good',
      }
    case 'chosen':
      return { text: tr('sessions.why.chosen'), tone: 'text-fg-faint' }
    default:
      return { text: tr('sessions.why.start'), tone: 'text-fg-faint' }
  }
}

export function SessionWhyLine({
  why,
  selected,
  busy,
  alternatives,
  onPick,
}: {
  why: SessionWhy
  selected: boolean
  busy: boolean
  alternatives: readonly SessionTrack[]
  onPick: (track: SessionTrack) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const phrase = phraseOf(why, tr)
  const canChange = selected && alternatives.length > 0
  return (
    <div data-testid="session-why" className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[11px] leading-4">
        <span title={phrase.text} className={`min-w-0 truncate ${phrase.tone}`}>
          {phrase.text}
        </span>
        {canChange && (
          <button
            type="button"
            data-testid="session-why-change"
            disabled={busy}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation()
              setOpen((was) => !was)
            }}
            className="press ml-auto shrink-0 text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {tr('sessions.why.change')} ▾
          </button>
        )}
      </div>
      {canChange && open && (
        <ul
          aria-label={tr('sessions.why.pick')}
          className="overflow-hidden rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-field)]"
        >
          {alternatives.map((track) => (
            <li key={track.id} className="border-t border-[var(--color-line)] first:border-t-0">
              <button
                type="button"
                data-testid={`session-why-alt-${track.id}`}
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  onPick(track)
                }}
                className="flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--color-hover)] disabled:opacity-50"
              >
                <span className="min-w-0 truncate">
                  {track.artist}
                  {track.artist && ' - '}
                  {track.title}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-fg-dim">
                  {[track.key, track.bpm > 0 ? Math.round(track.bpm) : null]
                    .filter((part) => part !== null)
                    .join(' ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
