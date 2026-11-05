import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { CueFlow } from '../../../shared/cueFlows'
import { rejectedCues } from '../../../shared/cueRules'
import {
  EXAMPLE_DURATION_MS,
  EXAMPLE_GRID,
  EXAMPLE_POINT_BAR,
  EXAMPLE_TRACK,
  EXAMPLE_WAVE,
  examplePlan,
} from '../lib/cueExample'
import { CueWave } from './CueWave'

export function CueFlowPreview({ flow }: { flow: CueFlow }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const out = examplePlan(flow)
  const cues =
    out.status === 'too-many'
      ? []
      : out.wanted.map((c, i) => ({ ...c, key: `${i}`, pending: false }))
  const leftOut = rejectedCues(flow, EXAMPLE_TRACK).filter((c) => c.reason !== 'limit')
  return (
    <div data-testid="cue-flow-preview">
      <CueWave
        wave={EXAMPLE_WAVE}
        grid={EXAMPLE_GRID}
        durationMs={EXAMPLE_DURATION_MS}
        cues={cues}
        trimmed={out.status === 'plan' ? out.trimmed : []}
        ghost={{ added: [], gone: [], rejected: leftOut }}
        readOnly
      />
      <p className="mt-1 text-[11px] text-fg-dim">
        {tr('settings.cueFlows.previewHint', { bar: EXAMPLE_POINT_BAR })}
      </p>
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
