import type { TFunction } from 'i18next'
import { Lock, LockOpen } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionWhy } from '../../../shared/sessionBuild'
import type { SessionTrack } from '../../../shared/sessionTypes'
import { Tooltip } from './Tooltip'

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
    case 'partner':
      return {
        text: tr('sessions.why.partner'),
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
        text:
          why.rating > 0
            ? tr('sessions.why.tasteRated', { stars: Math.round(why.rating / 20) })
            : tr('sessions.why.tastePlayed', { count: why.plays }),
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
    case 'phase':
      return {
        text: tr(why.phase === 'open' ? 'sessions.why.phaseOpen' : 'sessions.why.phaseClose'),
        tone: 'text-[var(--color-accent)]',
      }
    default:
      return { text: tr('sessions.why.start'), tone: 'text-fg-faint' }
  }
}

export function SessionWhyLine({
  track,
  why,
  busy,
  locked,
  onToggleLock,
}: {
  track: SessionTrack
  why: SessionWhy
  busy: boolean
  locked: boolean
  onToggleLock: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const phrase = phraseOf(why, tr)
  const placed = track.bpm > 0 ? String(Math.round(track.bpm)) : ''
  return (
    <div data-testid="session-why" className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[11px] leading-4">
        {placed && (
          <span
            data-testid="session-why-track"
            className="shrink-0 font-mono text-[11px] text-fg-dim"
          >
            {placed}
          </span>
        )}
        <span className={`relative min-w-0 truncate ${phrase.tone}`}>
          <Tooltip label={phrase.text} />
          {phrase.text}
        </span>
        <button
          type="button"
          data-testid="session-why-lock"
          aria-pressed={locked}
          aria-label={tr(locked ? 'sessions.why.unlock' : 'sessions.why.lock')}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            onToggleLock()
          }}
          className={`press relative ml-auto shrink-0 disabled:opacity-50 ${
            locked ? 'text-[var(--color-accent)]' : 'text-fg-faint hover:text-fg'
          }`}
        >
          <Tooltip label={tr(locked ? 'sessions.why.unlock' : 'sessions.why.lock')} />
          {locked ? (
            <Lock size={12} aria-hidden="true" />
          ) : (
            <LockOpen size={12} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  )
}
