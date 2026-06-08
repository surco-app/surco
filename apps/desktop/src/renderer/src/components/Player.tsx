import { Pause, Play, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTime } from '../lib/duration'
import type { TrackItem } from '../types'

// Owns the playback clock by subscribing straight to the shared <audio> element,
// so the ~4Hz timeupdate stream re-renders only this card — not App, the editor
// and the whole track list, as it did when currentTime lived in App state.
export function LivePlayer({
  track,
  audioRef,
  onClose,
}: {
  track: TrackItem
  audioRef: React.RefObject<HTMLAudioElement | null>
  onClose: () => void
}): React.JSX.Element {
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    // Sync immediately: the track may already be loaded and playing by the time
    // the card mounts, so we can't wait for the next event to show a time.
    const readDuration = (): number => (Number.isFinite(audio.duration) ? audio.duration : 0)
    setCurrentTime(audio.currentTime)
    setDuration(readDuration())
    setPaused(audio.paused)
    const onTime = (): void => setCurrentTime(audio.currentTime)
    const onMeta = (): void => setDuration(readDuration())
    const onPlay = (): void => setPaused(false)
    const onPause = (): void => setPaused(true)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [audioRef])

  function onToggle(): void {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }

  // Reads the live duration off the element rather than closing over state.
  function onSeek(ratio: number): void {
    const audio = audioRef.current
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = ratio * audio.duration
  }

  return (
    <Player
      track={track}
      paused={paused}
      progress={duration > 0 ? currentTime / duration : 0}
      currentTime={currentTime}
      duration={duration}
      onToggle={onToggle}
      onSeek={onSeek}
      onClose={onClose}
    />
  )
}

interface PlayerProps {
  track: TrackItem
  paused: boolean
  progress: number
  currentTime: number
  duration: number
  onToggle: () => void
  onSeek: (ratio: number) => void
  onClose: () => void
}

// Floats over the bottom of the track column and slides up on open. The progress
// bar spans the full width and seeks to wherever it's clicked.
export function Player({
  track,
  paused,
  progress,
  currentTime,
  duration,
  onToggle,
  onSeek,
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
          className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
        >
          {paused ? (
            <Play className="h-4 w-4" fill="currentColor" strokeWidth={0} aria-hidden="true" />
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
          data-testid="player-close"
          onClick={onClose}
          aria-label={t('player.close')}
          className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-dim transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Scrubber and clock share the thin bottom strip. Pointer-only: a thin bar
          is a poor keyboard target, and Space already toggles the player. The thumb
          surfaces on hover so the bar stays clean while signalling it's draggable. */}
      <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2.5">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only scrubber by design */}
        <span
          data-testid="player-seek"
          role="slider"
          aria-label={t('player.seek')}
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={-1}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
          }}
          className="group relative flex h-4 flex-1 cursor-pointer items-center"
        >
          <span className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-line-strong)]">
            <span
              className="block h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-200"
              style={{ width: `${progress * 100}%` }}
            />
          </span>
          <span
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100"
            style={{ left: `${progress * 100}%` }}
          />
        </span>

        <span data-testid="player-time" className="shrink-0 text-fg-dim text-xs tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  )
}
