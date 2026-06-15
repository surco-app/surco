import { Infinity as InfinityIcon, LoaderCircle, Pause, Play, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTime } from '../lib/duration'
import type { TrackItem } from '../types'
import { Waveform } from './Waveform'

// Owns the playback clock by subscribing straight to the shared <audio> element,
// so the ~4Hz timeupdate stream re-renders only this card — not App, the editor
// and the whole track list, as it did when currentTime lived in App state.
export function LivePlayer({
  track,
  audioRef,
  continuous,
  onToggleContinuous,
  onClose,
}: {
  track: TrackItem
  audioRef: React.RefObject<HTMLAudioElement | null>
  continuous: boolean
  onToggleContinuous: () => void
  onClose: () => void
}): React.JSX.Element {
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    // Sync immediately: the track may already be loaded and playing by the time
    // the card mounts, so we can't wait for the next event to show a time.
    const readDuration = (): number => (Number.isFinite(audio.duration) ? audio.duration : 0)
    setCurrentTime(audio.currentTime)
    setDuration(readDuration())
    setPaused(audio.paused)
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

  return (
    <Player
      track={track}
      paused={paused}
      loading={loading}
      currentTime={currentTime}
      duration={duration}
      audioRef={audioRef}
      continuous={continuous}
      onToggle={onToggle}
      onScrub={onScrub}
      onToggleContinuous={onToggleContinuous}
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
  onToggle: () => void
  onScrub: (seconds: number) => void
  onToggleContinuous: () => void
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
  onToggle,
  onScrub,
  onToggleContinuous,
  onClose,
}: PlayerProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      data-testid="player"
      className="absolute inset-x-3 bottom-3 z-20 animate-player-in overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)] shadow-lg shadow-black/30"
    >
      {/* Identity row: cover, play and the full track name. In a narrow sidebar the
          clock used to share this line too and crushed the title to a couple of
          letters, so only it moves down beside the scrubber. */}
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

        <button
          type="button"
          data-testid="player-toggle"
          onClick={onToggle}
          aria-label={paused ? t('player.play') : t('player.pause')}
          aria-busy={!paused && loading}
          className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
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

        <button
          type="button"
          data-testid="player-continuous"
          onClick={onToggleContinuous}
          aria-label={t('player.continuous')}
          aria-pressed={continuous}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
            continuous
              ? 'text-[var(--color-accent)] hover:bg-[var(--color-line-strong)]'
              : 'text-fg-dim hover:bg-[var(--color-line-strong)] hover:text-fg'
          }`}
        >
          <InfinityIcon className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          data-testid="player-close"
          onClick={onClose}
          aria-label={t('player.close')}
          className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-dim transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* The waveform runs full-bleed to the card edges (the rounded card clips its
          corners) so the whole width is scrubbable. The clock floats over it as a
          pill; pointer-events-none lets a click underneath still seek. */}
      <div className="relative mt-2">
        <Waveform
          key={track.inputPath}
          inputPath={track.inputPath}
          audioRef={audioRef}
          active
          onScrub={onScrub}
        />
        <span
          data-testid="player-time"
          className="pointer-events-none absolute top-1 right-1 rounded-full bg-[var(--color-panel-2)]/85 px-1.5 py-px text-[10px] text-fg-dim leading-none tabular-nums shadow-sm ring-1 ring-[var(--color-line)] backdrop-blur-sm"
        >
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  )
}
