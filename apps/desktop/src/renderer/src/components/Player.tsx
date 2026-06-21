import {
  AudioLines,
  Infinity as InfinityIcon,
  LoaderCircle,
  Pause,
  Play,
  Volume2,
  X,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTime } from '../lib/duration'
import type { TrackItem } from '../types'
import { Tooltip } from './Tooltip'
import { Waveform } from './Waveform'

// Owns the playback clock by subscribing straight to the shared <audio> element,
// so the ~4Hz timeupdate stream re-renders only this card — not App, the editor
// and the whole track list, as it did when currentTime lived in App state.
export function LivePlayer({
  track,
  audioRef,
  continuous,
  onToggleContinuous,
  showWaveform,
  onToggleWaveform,
  onClose,
}: {
  track: TrackItem
  audioRef: React.RefObject<HTMLAudioElement | null>
  continuous: boolean
  onToggleContinuous: () => void
  showWaveform: boolean
  onToggleWaveform: () => void
  onClose: () => void
}): React.JSX.Element {
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState(false)
  // Volume is adjusted by scrolling over the card (no on-screen control, to keep the
  // player minimal); the value rides the volume pill that fades in on hover.
  const [volume, setVolume] = useState(1)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    // Sync immediately: the track may already be loaded and playing by the time
    // the card mounts, so we can't wait for the next event to show a time.
    const readDuration = (): number => (Number.isFinite(audio.duration) ? audio.duration : 0)
    setCurrentTime(audio.currentTime)
    setDuration(readDuration())
    setPaused(audio.paused)
    // The element keeps its volume across track changes, so reflect the live value
    // rather than assuming full on every reopen.
    setVolume(audio.volume)
    // On network drives the element can spend seconds fetching before sound starts;
    // readyState seeds the state because play() usually fired before this mount.
    setLoading(!audio.paused && audio.readyState < audio.HAVE_FUTURE_DATA)
    const onTime = (): void => setCurrentTime(audio.currentTime)
    const onMeta = (): void => setDuration(readDuration())
    const onPlay = (): void => setPaused(false)
    const onPause = (): void => setPaused(true)
    const onWaiting = (): void => setLoading(true)
    const onReady = (): void => setLoading(false)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('loadstart', onWaiting)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('canplay', onReady)
    audio.addEventListener('playing', onReady)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('loadstart', onWaiting)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('canplay', onReady)
      audio.removeEventListener('playing', onReady)
    }
  }, [audioRef])

  function onToggle(): void {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }

  // Reads the live duration off the element rather than closing over state.
  function onScrub(seconds: number): void {
    const audio = audioRef.current
    if (audio && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(Math.max(seconds, 0), audio.duration)
    }
  }

  // A wheel notch nudges the volume 5%. Scroll up raises it; the level is mirrored on
  // the element, which persists it across tracks, and shown live on the volume pill.
  const onAdjustVolume = useCallback(
    (deltaY: number): void => {
      const audio = audioRef.current
      if (!audio) return
      const next = Math.min(1, Math.max(0, audio.volume - Math.sign(deltaY) * 0.05))
      audio.volume = next
      setVolume(next)
    },
    [audioRef],
  )

  return (
    <Player
      track={track}
      paused={paused}
      loading={loading}
      currentTime={currentTime}
      duration={duration}
      audioRef={audioRef}
      continuous={continuous}
      volume={volume}
      onToggle={onToggle}
      onScrub={onScrub}
      onAdjustVolume={onAdjustVolume}
      onToggleContinuous={onToggleContinuous}
      showWaveform={showWaveform}
      onToggleWaveform={onToggleWaveform}
      onClose={onClose}
    />
  )
}

interface PlayerProps {
  track: TrackItem
  paused: boolean
  loading: boolean
  currentTime: number
  duration: number
  audioRef: React.RefObject<HTMLAudioElement | null>
  continuous: boolean
  volume: number
  onToggle: () => void
  onScrub: (seconds: number) => void
  onAdjustVolume: (deltaY: number) => void
  onToggleContinuous: () => void
  showWaveform: boolean
  onToggleWaveform: () => void
  onClose: () => void
}

// Floats over the bottom of the track column and slides up on open. A small
// waveform spans the strip and seeks to wherever it's clicked or dragged.
export function Player({
  track,
  paused,
  loading,
  currentTime,
  duration,
  audioRef,
  continuous,
  volume,
  onToggle,
  onScrub,
  onAdjustVolume,
  onToggleContinuous,
  showWaveform,
  onToggleWaveform,
  onClose,
}: PlayerProps): React.JSX.Element {
  const { t } = useTranslation()
  const cardRef = useRef<HTMLDivElement>(null)
  // The volume and time pills only surface while the pointer is over the card, then
  // fade back out, so the resting player stays just cover + name + controls + wave.
  const [hovered, setHovered] = useState(false)

  // Wheel-to-volume, attached natively so the handler can preventDefault and stop the
  // track list behind the floating card from scrolling at the same time (React's
  // onWheel is passive and can't).
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      onAdjustVolume(e.deltaY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onAdjustVolume])

  return (
    <div
      ref={cardRef}
      data-testid="player"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="absolute inset-x-3 bottom-3 z-20 animate-player-in overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)] shadow-lg shadow-black/30"
    >
      {/* Identity row: cover and the full track name, with every control grouped in
          one cluster on the right. The clock lives down on the waveform, so the name
          keeps the whole middle. */}
      <div className="flex items-center gap-2.5 px-2.5 pt-2.5">
        {track.coverUrl ? (
          <img
            src={track.coverUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10"
          />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-md bg-[var(--color-panel)]" />
        )}

        <span className="min-w-0 flex-1">
          <span
            data-testid="player-title"
            className="block truncate font-medium text-sm leading-tight"
          >
            {track.meta.title || track.fileName}
          </span>
          <span className="block truncate text-fg-dim text-xs leading-tight">
            {track.meta.artist}
          </span>
        </span>

        <div className="-mr-1 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            data-testid="player-toggle"
            onClick={onToggle}
            aria-label={paused ? t('player.play') : t('player.pause')}
            aria-busy={!paused && loading}
            className="press flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-accent)] transition-colors hover:bg-[var(--color-line-strong)]"
          >
            {paused ? (
              <Play className="h-4 w-4" fill="currentColor" strokeWidth={0} aria-hidden="true" />
            ) : loading ? (
              // Streaming from a network drive can take seconds to deliver the first
              // bytes; the spinner shows the click registered and the file is coming.
              <LoaderCircle
                data-testid="player-loading"
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            data-testid="player-continuous"
            onClick={onToggleContinuous}
            aria-label={t('player.continuous')}
            aria-pressed={continuous}
            className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-line-strong)] ${
              continuous ? 'text-[var(--color-accent)]' : 'text-fg-dim hover:text-fg'
            }`}
          >
            <InfinityIcon className="h-4 w-4" aria-hidden="true" />
            <Tooltip label={t('player.continuousHelp')} />
          </button>

          <button
            type="button"
            data-testid="player-waveform"
            onClick={onToggleWaveform}
            aria-label={t('player.waveform')}
            aria-pressed={showWaveform}
            className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-line-strong)] ${
              showWaveform ? 'text-[var(--color-accent)]' : 'text-fg-dim hover:text-fg'
            }`}
          >
            <AudioLines className="h-4 w-4" aria-hidden="true" />
            <Tooltip label={t('player.waveformHelp')} />
          </button>

          <button
            type="button"
            data-testid="player-close"
            onClick={onClose}
            aria-label={t('player.close')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-dim transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* The waveform runs full-bleed to the card edges (the rounded card clips its
          corners) so the whole width is scrubbable. The volume and clock float over its
          corners as pills that fade in on hover; pointer-events-none lets a click (or a
          wheel) underneath still reach the wave. Hidden by the toggle, the whole strip is
          unmounted so its full-file decode never runs — the point of the preference. */}
      {showWaveform ? (
        <div className="relative mt-2">
          <Waveform
            key={track.inputPath}
            inputPath={track.inputPath}
            audioRef={audioRef}
            active
            audioDurationSec={duration}
            onScrub={onScrub}
          />
          <span
            data-testid="player-volume"
            className={`pointer-events-none absolute top-1 left-1 flex items-center gap-1 rounded-full bg-[var(--color-panel-2)]/85 px-1.5 py-px text-[10px] text-fg-dim leading-none tabular-nums shadow-sm ring-1 ring-[var(--color-line)] backdrop-blur-sm transition-opacity duration-200 ${
              hovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <Volume2 className="h-3 w-3" aria-hidden="true" />
            {Math.round(volume * 100)}%
          </span>
          <span
            data-testid="player-time"
            className={`pointer-events-none absolute top-1 right-1 rounded-full bg-[var(--color-panel-2)]/85 px-1.5 py-px text-[10px] text-fg-dim leading-none tabular-nums shadow-sm ring-1 ring-[var(--color-line)] backdrop-blur-sm transition-opacity duration-200 ${
              hovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      ) : (
        // No waveform: a slim transport row keeps the volume, a scrubbable progress bar and
        // the clock — the info the waveform overlay carried — and its bottom padding balances
        // the card so the row above isn't left hugging the edge.
        <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2.5 text-[10px] text-fg-dim tabular-nums">
          <span data-testid="player-volume" className="flex shrink-0 items-center gap-1">
            <Volume2 className="h-3 w-3" aria-hidden="true" />
            {Math.round(volume * 100)}%
          </span>
          <button
            type="button"
            data-testid="player-seek"
            aria-label={t('player.seek')}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              if (duration > 0) onScrub(((e.clientX - rect.left) / rect.width) * duration)
            }}
            className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--color-panel)]"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)]"
              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
          </button>
          <span data-testid="player-time" className="shrink-0">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      )}
    </div>
  )
}
