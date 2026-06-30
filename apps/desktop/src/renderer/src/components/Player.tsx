import {
  AudioLines,
  Infinity as InfinityIcon,
  LoaderCircle,
  Music,
  Pause,
  Play,
  Volume2,
  X,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTime } from '../lib/duration'
import type { TrackItem } from '../types'
import { MarqueeText } from './MarqueeText'
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
  // Volume rides a slider on the volume pill (which fades in on hover); a slider rather
  // than wheel-over-the-card so adjusting it never collides with scrolling the track list.
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

  // The slider reports an absolute level; mirror it onto the element, which persists it
  // across tracks, and reflect it live on the pill.
  const onSetVolume = useCallback(
    (value: number): void => {
      const audio = audioRef.current
      if (!audio) return
      const next = Math.min(1, Math.max(0, value))
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
      onSetVolume={onSetVolume}
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
  onSetVolume: (value: number) => void
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
  onSetVolume,
  onToggleContinuous,
  showWaveform,
  onToggleWaveform,
  onClose,
}: PlayerProps): React.JSX.Element {
  const { t } = useTranslation()
  const sectionRef = useRef<HTMLDivElement>(null)
  const sectionHeightRef = useRef<number | undefined>(undefined)
  // The volume and time pills only surface while the pointer is over the card, then
  // fade back out, so the resting player stays just cover + name + controls + wave.
  const [hovered, setHovered] = useState(false)

  // The tall waveform strip and the slim transport row are different heights, so flipping
  // the preference would jump the card. Tween the section's height from its last measured
  // value to the new content height; the .player-section class carries the transition so
  // prefers-reduced-motion (index.css) can neutralise it. Clearing height before measuring
  // keeps the target correct when the toggle is spammed mid-animation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the body reads only refs; showWaveform is the trigger — the height must re-tween exactly when the layout swaps, not on every clock re-render.
  useLayoutEffect(() => {
    const el = sectionRef.current
    if (!el) return
    el.style.height = ''
    const next = el.scrollHeight
    const prev = sectionHeightRef.current
    sectionHeightRef.current = next
    if (prev === undefined || prev === next) return
    el.style.height = `${prev}px`
    void el.scrollHeight
    el.style.height = `${next}px`
    const settle = (): void => {
      el.style.height = ''
      el.removeEventListener('transitionend', settle)
    }
    el.addEventListener('transitionend', settle)
    return () => el.removeEventListener('transitionend', settle)
  }, [showWaveform])

  return (
    <div
      data-testid="player"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="group/player absolute inset-x-3 bottom-3 z-20 animate-player-in overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)] shadow-lg shadow-black/30"
    >
      {/* One compact row: cover and the headline title/artist on the left, the controls on
          the right grouped into three zones — transport (play), the two player toggles
          (continuous + waveform) set off by a hairline, then close held a little apart as an
          exit, not a peer control. The title still owns the middle (marquees on hover when it
          can't fit); the controls stay bare ghost glyphs so they never out-shout the track. */}
      <div className="flex items-center gap-2.5 px-3 pt-2.5">
        {track.embeddedCover ? (
          <img
            data-testid="player-cover"
            src={track.embeddedCover}
            alt=""
            className="h-9 w-9 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10"
          />
        ) : (
          <span
            data-testid="player-cover-placeholder"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-panel)] outline outline-1 -outline-offset-1 outline-white/10"
          >
            <Music className="h-4 w-4 text-fg-faint" aria-hidden="true" />
          </span>
        )}

        <span data-testid="player-title" className="min-w-0 flex-1">
          <MarqueeText className="font-semibold text-[15px] leading-tight">
            {track.meta.title || track.fileName}
          </MarqueeText>
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
            className="press flex h-8 w-8 items-center justify-center rounded-md text-fg transition-colors hover:bg-[var(--color-line-strong)]"
          >
            {paused ? (
              // The play triangle is optically left-heavy, so nudge it right to sit centered.
              <Play
                className="h-4 w-4 translate-x-px"
                fill="currentColor"
                strokeWidth={0}
                aria-hidden="true"
              />
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

          {/* Hairline marking off the transport from the two settings toggles. */}
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-[var(--color-line)]" />

          <button
            type="button"
            data-testid="player-continuous"
            onClick={onToggleContinuous}
            aria-label={t('player.continuous')}
            aria-pressed={continuous}
            className={`press relative flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-line-strong)] ${
              continuous ? 'text-[var(--color-accent)]' : 'text-fg-faint hover:text-fg'
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
            className={`press relative flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-line-strong)] ${
              showWaveform ? 'text-[var(--color-accent)]' : 'text-fg-faint hover:text-fg'
            }`}
          >
            <AudioLines className="h-4 w-4" aria-hidden="true" />
            <Tooltip label={t('player.waveformHelp')} />
          </button>

          {/* Close held a touch apart — an exit, not a control, so a stray click doesn't kill
              the player in place of a toggle. */}
          <button
            type="button"
            data-testid="player-close"
            onClick={onClose}
            aria-label={t('player.close')}
            className="press ml-1 flex h-8 w-8 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* The waveform runs full-bleed to the card edges (the rounded card clips its
          corners) so the whole width is scrubbable. The clock and the volume slider float
          over its corners as pills that fade in on hover; the clock is pointer-events-none so
          a click underneath still reaches the wave, while the volume pill takes pointer events
          for its slider. Hidden by the toggle, the whole strip is unmounted so its full-file
          decode never runs — the point of the preference. The wrapper clips and animates the
          height as the two layouts swap (see useLayoutEffect). */}
      <div ref={sectionRef} className="player-section overflow-hidden">
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
            <VolumePill
              volume={volume}
              onSetVolume={onSetVolume}
              label={t('player.volume')}
              className={`absolute top-1 left-1 bg-[var(--color-panel-2)]/85 px-1.5 py-px shadow-sm ring-1 ring-[var(--color-line)] backdrop-blur-sm transition-opacity duration-200 ${
                hovered ? 'opacity-100' : 'opacity-0'
              }`}
            />
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
          // No waveform: one compact line — a volume button that pops its slider on hover, the
          // progress bar taking the whole middle, and the clock at the end. No second row and
          // no empty space where the waveform used to be, so the player shrinks to a tidy
          // transport bar instead of holding the wave's height with thin controls.
          <div className="flex items-center gap-2.5 px-3 pt-1.5 pb-2.5 text-[10px] text-fg-dim tabular-nums">
            <VolumeButton volume={volume} onSetVolume={onSetVolume} label={t('player.volume')} />
            {/* The visible track is 4px, but the button is taller with a centered bar inside,
                so the clickable target clears the 40px-ish comfort zone — a thin 6px bar was
                fiddly to hit mid-set. */}
            <button
              type="button"
              data-testid="player-seek"
              aria-label={t('player.seek')}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                if (duration > 0) onScrub(((e.clientX - rect.left) / rect.width) * duration)
              }}
              className="group/seek relative flex h-4 min-w-0 flex-1 items-center"
            >
              <span className="relative h-1 w-full overflow-hidden rounded-full bg-[var(--color-panel)] transition-[height] group-hover/seek:h-1.5">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)]"
                  style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                />
              </span>
            </button>
            <span data-testid="player-time" className="shrink-0">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// The no-waveform line's volume control: just a speaker glyph until hovered, then a slider
// pops out beside it. Keeping it collapsed hands the whole row width to the progress bar —
// the wheel-free slider still means volume never hijacks a scroll meant for the track list,
// and a turned-down level shows as a dimmer icon so the collapsed state isn't a black box.
function VolumeButton({
  volume,
  onSetVolume,
  label,
}: {
  volume: number
  onSetVolume: (value: number) => void
  label: string
}): React.JSX.Element {
  return (
    <span
      data-testid="player-volume-pill"
      className="group/vol relative flex shrink-0 items-center"
    >
      <Volume2
        className={`h-3.5 w-3.5 transition-colors ${volume < 1 ? 'text-fg-faint' : 'text-fg-dim'}`}
        aria-hidden="true"
      />
      {/* The slider floats in a popover anchored above the icon — out of the flow, so it
          never shoves the progress bar sideways as it appears. The icon holds a fixed spot;
          the panel reveals on hover/focus-within and pointer-events gate it while hidden. */}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 py-1.5 opacity-0 shadow-md transition-opacity duration-150 group-hover/vol:pointer-events-auto group-hover/vol:opacity-100 group-focus-within/vol:pointer-events-auto group-focus-within/vol:opacity-100">
        <input
          type="range"
          data-testid="player-volume-slider"
          aria-label={label}
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onSetVolume(Number(e.target.value))}
          className="player-volume-range block h-1 w-20 cursor-pointer"
        />
      </span>
    </span>
  )
}

// The volume pill: a speaker icon, a draggable range and the live percentage. Shared by the
// waveform overlay and the slim transport row so both drive the volume the same way. A real
// slider (rather than wheel-over-the-card) means adjusting volume never hijacks a scroll meant
// for the track list. The number stays tabular so the pill width doesn't twitch as digits change.
function VolumePill({
  volume,
  onSetVolume,
  label,
  className,
}: {
  volume: number
  onSetVolume: (value: number) => void
  label: string
  className: string
}): React.JSX.Element {
  return (
    <span
      data-testid="player-volume-pill"
      className={`flex items-center gap-1 rounded-full text-[10px] text-fg-dim leading-none tabular-nums ${className}`}
    >
      <Volume2 className="h-3 w-3 shrink-0" aria-hidden="true" />
      <input
        type="range"
        data-testid="player-volume-slider"
        aria-label={label}
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => onSetVolume(Number(e.target.value))}
        className="player-volume-range h-1 w-16 cursor-pointer"
      />
      {/* Full volume is the silent default, so the readout only appears once the user has
          turned it down — where the exact figure is worth its space. */}
      {volume < 1 && (
        <span data-testid="player-volume" className="w-7 shrink-0 text-right">
          {Math.round(volume * 100)}%
        </span>
      )}
    </span>
  )
}
