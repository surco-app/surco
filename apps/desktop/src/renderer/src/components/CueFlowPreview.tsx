import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CueFlow } from '../../../shared/cueFlows'
import { rejectedCues } from '../../../shared/cueRules'
import type { TrackCues } from '../../../shared/types'
import { useTrackCues } from '../hooks/useTrackCues'
import {
  differingHot,
  EXAMPLE_DURATION_MS,
  EXAMPLE_GRID,
  EXAMPLE_POINT_BAR,
  EXAMPLE_TRACK,
  EXAMPLE_WAVE,
  examplePlan,
  trackOfCues,
  trackPlan,
} from '../lib/cueExample'
import { CueWave } from './CueWave'
import { SegmentedControl } from './SegmentedControl'

type Source = 'track' | 'example'

export function CueFlowPreview({
  flow,
  track,
}: {
  flow: CueFlow
  track?: { label: string; cues: TrackCues }
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [source, setSource] = useState<Source>('track')
  const real = track?.cues.analysed ? trackOfCues(track.cues) : null
  const marked = real !== null && real.drops.length > 0
  const onTrack = track !== undefined && real !== null && marked && source === 'track'
  const base = onTrack ? real : EXAMPLE_TRACK
  const out = onTrack ? trackPlan(flow, real) : examplePlan(flow)
  const cues =
    out.status === 'too-many'
      ? []
      : out.wanted.map((c, i) => ({ ...c, key: `${i}`, pending: false }))
  const leftOut = rejectedCues(flow, base).filter((c) => c.reason !== 'limit')
  const differ =
    onTrack && out.status !== 'too-many'
      ? differingHot(
          out.wanted.filter((c) => c.kind !== 0).map((c) => c.ms),
          track.cues.cues.filter((c) => c.kind !== 0 && !c.loop).map((c) => c.ms),
        )
      : null
  return (
    <div data-testid="cue-flow-preview">
      {track && marked && (
        <SegmentedControl<Source>
          options={['track', 'example']}
          value={source}
          onChange={setSource}
          testidPrefix="cue-preview-source"
          labelFor={(s) => (s === 'track' ? track.label : tr('settings.cueFlows.exampleTrack'))}
          label={tr('settings.cueFlows.preview')}
          compact
          className="mb-2"
        />
      )}
      <CueWave
        wave={onTrack ? track.cues.wave : EXAMPLE_WAVE}
        grid={onTrack ? track.cues.grid : EXAMPLE_GRID}
        durationMs={onTrack ? track.cues.durationMs : EXAMPLE_DURATION_MS}
        cues={cues}
        trimmed={out.status === 'plan' ? out.trimmed : []}
        ghost={{ added: [], gone: [], rejected: leftOut }}
        readOnly
      />
      {!onTrack && (
        <p className="mt-1 text-[11px] text-fg-dim">
          {tr('settings.cueFlows.previewHint', { bar: EXAMPLE_POINT_BAR })}
        </p>
      )}
      {track && real !== null && !marked && (
        <p data-testid="cue-preview-no-mark" className="mt-1 text-[11px] text-fg-dim">
          {tr('settings.cueFlows.noMark', { label: track.label })}
        </p>
      )}
      {differ !== null && (
        <p
          data-testid="cue-preview-compare"
          className={`mt-1 text-xs ${differ === 0 ? 'text-good' : 'text-warn'}`}
        >
          {differ === 0
            ? tr('settings.cueFlows.compareSame')
            : tr('settings.cueFlows.compareDiffer', { count: differ })}
        </p>
      )}
      {leftOut.length > 0 && (
        <ul data-testid="cue-preview-left-out" className="mt-1 text-xs text-fg-dim">
          {leftOut.map((c) => (
            <li key={`${c.rule}-${c.ms}`}>
              {`${tr(`settings.cueFlows.leftOut.${flow.rules[c.rule].direction}`, {
                rule: c.rule + 1,
                count: c.bars,
              })}. ${tr(`settings.cueFlows.leftOut.reason.${c.reason}`)}`}
            </li>
          ))}
        </ul>
      )}
      {out.status === 'too-many' && (
        <p data-testid="cue-preview-too-many" className="mt-1 text-xs text-warn">
          {tr('settings.cueFlows.tooMany', { count: out.needed })}
        </p>
      )}
      {out.status === 'plan' && out.trimmed.length > 0 && (
        <p data-testid="cue-preview-trimmed" className="mt-1 text-xs text-fg-dim">
          {tr('editor.cues.trimmed', { count: out.trimmed.length })}
        </p>
      )}
    </div>
  )
}

export function CueFlowTrackPreview({
  flow,
  track,
}: {
  flow: CueFlow
  track: { contentId: string; label: string }
}): React.JSX.Element {
  const { data } = useTrackCues(track.contentId)
  return (
    <CueFlowPreview flow={flow} track={data ? { label: track.label, cues: data } : undefined} />
  )
}
