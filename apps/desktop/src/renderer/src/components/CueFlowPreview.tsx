import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { CueFlow } from '../../../shared/cueFlows'
import { EXAMPLE_DURATION_MS, EXAMPLE_GRID, EXAMPLE_WAVE, examplePlan } from '../lib/cueExample'
import { CueWave } from './CueWave'

export function CueFlowPreview({ flow }: { flow: CueFlow }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const out = examplePlan(flow)
  const cues =
    out.status === 'too-many'
      ? []
      : out.wanted.map((c, i) => ({ ...c, key: `${i}`, pending: false }))
  return (
    <div data-testid="cue-flow-preview">
      <CueWave
        wave={EXAMPLE_WAVE}
        grid={EXAMPLE_GRID}
        durationMs={EXAMPLE_DURATION_MS}
        cues={cues}
        trimmed={out.status === 'plan' ? out.trimmed : []}
        readOnly
      />
      <p className="mt-1 text-[11px] text-fg-dim">{tr('settings.cueFlows.previewHint')}</p>
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
