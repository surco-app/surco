import { Square, Volume2 } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mediaUrl } from '../../../shared/media'
import type { DeclickMode, OutputFormat } from '../../../shared/types'
import { useClickCount } from '../hooks/useClickCount'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { DeclickControls } from './DeclickControls'
import { SectionHeader } from './SectionHeader'
import { Tooltip } from './Tooltip'

// The formats whose re-encode carries the Traktor cue/beatgrid frame over (see
// convertAudio's copyCueFrames): converting to these loses nothing, so the amber
// cue warning would be pure noise there.
const CUES_SURVIVE: OutputFormat[] = ['mp3', 'aiff']

interface Props {
  value: DeclickMode
  open: boolean
  onToggle: () => void
  onChange: (config: DeclickMode) => void
  // The track the audition renders from; the button hides in multi-select, where
  // the anchor track's excerpt would misrepresent the rest of the selection.
  inputPath: string
  isMulti: boolean
  // The export format the convert button will use — the cue warning only shows for
  // the formats that actually drop the cues.
  format: OutputFormat
}

type Audition = 'idle' | 'rendering' | 'playing' | 'failed'

// The per-track click-repair override, with the active mode badged on the header so
// a folded section still shows that the convert will repair clicks — the same
// contract as NormalizeSection's badge.
export function DeclickSection({
  value,
  open,
  onToggle,
  onChange,
  inputPath,
  isMulti,
  format,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The RX-style counter: Surco's own audible-click estimate for the whole track
  // (see clickDetect.ts). Waits for the selection to rest like the other per-track
  // analyses, and only runs while the section is open on a single track.
  const settled = useSettled(SELECTION_SETTLE_MS)
  const { data: clicks } = useClickCount(inputPath, open && !isMulti && settled)
  // The "hear what gets removed" audition (RX's "output clicks only"): a 20 s render
  // of exactly what the active mode would take out, played once through a local
  // element. Stopped when the mode changes or the section unmounts — the render no
  // longer matches the dials, and an orphaned element would keep playing clicks.
  const [audition, setAudition] = useState<Audition>('idle')
  // The rendered excerpt's touched share (null until a render lands): the caption
  // that tells the user what the audition means. A share, not a sample count — on
  // clean dense music the detector fires on percussive transients, and a big raw
  // number reads as "my file is broken" where "6% — listen and judge" invites
  // exactly the check this button exists for.
  const [share, setShare] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is deliberately the trigger — a mode change invalidates the playing render, so the cleanup must fire on it.
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
      setAudition('idle')
      setShare(null)
    }
  }, [value])
  const audit = async (): Promise<void> => {
    if (audition === 'playing') {
      audioRef.current?.pause()
      audioRef.current = null
      setAudition('idle')
      return
    }
    setAudition('rendering')
    const preview = await window.api.declickPreview(inputPath, value)
    if (!preview) {
      setAudition('failed')
      return
    }
    setShare(preview.share)
    const audio = new Audio(mediaUrl(preview.path))
    audioRef.current = audio
    audio.onended = () => setAudition('idle')
    setAudition('playing')
    audio.play().catch(() => setAudition('failed'))
  }
  return (
    <div data-testid="editor-declick" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        title={tr('declick.title')}
        open={open}
        onToggle={onToggle}
        // Off is stated in the dim summary; active modes speak through the accent
        // badge instead, so the state renders exactly once either way.
        summary={value === 'off' ? tr('declick.mode.off') : undefined}
        summaryTestId="declick-summary"
        right={
          // Only while folded: open, the segmented control right below says the
          // same thing, and showing both reads as two controls for one fact.
          value !== 'off' && !open ? (
            <span
              data-testid="declick-active-badge"
              className="rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]"
            >
              {tr(`declick.mode.${value}`)}
            </span>
          ) : undefined
        }
      />
      {open && (
        <div className="mt-3">
          {/* No intro line — the section title already says what this is. The
              estimate speaks the user's language (events, not samples) and is
              deliberately worded "audible": clicks buried under loud passages mask
              from the detector much as they mask from the ear. */}
          {!isMulti && typeof clicks === 'number' && (
            <p data-testid="declick-estimate" className="mb-3 text-xs text-fg-muted">
              {clicks > 0
                ? tr('declick.estimate', { count: clicks })
                : tr('declick.estimateNone')}
            </p>
          )}
          <DeclickControls value={value} onChange={onChange} />
          {value !== 'off' && !isMulti && (
            <div className="mt-3">
              <button
                type="button"
                data-testid="declick-audition"
                disabled={audition === 'rendering'}
                onClick={() => void audit()}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
              >
                {audition === 'playing' ? (
                  <Square className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {tr(
                  audition === 'playing'
                    ? 'declick.auditionStop'
                    : audition === 'rendering'
                      ? 'declick.auditionBusy'
                      : 'declick.audition',
                )}
                {/* What the button plays is not obvious ("is this an example?"), so
                    the explanation lives on hover instead of as a standing paragraph
                    — the rendered share caption below is the inline feedback. */}
                <Tooltip label={tr('declick.auditionHint')} />
              </button>
              {share !== null && audition !== 'failed' && (
                <p data-testid="declick-audition-count" className="mt-1 text-xs text-fg-muted">
                  {share > 0
                    ? tr('declick.auditionShare', { percent: (share * 100).toFixed(1) })
                    : tr('declick.auditionClean')}
                </p>
              )}
              {audition === 'failed' && (
                <p data-testid="declick-audition-failed" className="mt-2 text-xs text-warn">
                  {tr('declick.auditionFailed')}
                </p>
              )}
            </div>
          )}
          {value !== 'off' && !CUES_SURVIVE.includes(format) && (
            <p data-testid="declick-cue-warning" className="mt-3 text-xs text-warn">
              {tr('normalize.cueWarning')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
