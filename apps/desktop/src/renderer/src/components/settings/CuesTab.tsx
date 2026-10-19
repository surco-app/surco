import { Loader2 } from 'lucide-react'
import type React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  activeCueFlow,
  type CueFlow,
  type CueRule,
  MY_FLOW_ID,
  restoreMyFlow,
} from '../../../../shared/cueFlows'
import type { LearnedFlow } from '../../../../shared/learnFlow'
import { flowName } from '../../lib/cueFlowName'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { CueFlowPreview } from '../CueFlowPreview'
import { CueRuleRow } from '../CueRuleRow'

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
  rekordboxCollection: string
}

type Learning = LearnedFlow | 'idle' | 'none' | 'failed'

const NEW_RULE: CueRule = {
  from: 'drop',
  direction: 'back',
  bars: 16,
  repeat: 1,
  when: 'fits',
  place: 'both',
  color: { fixed: 1 },
}

const BUTTON_CLASS =
  'press rounded-md border border-[var(--color-line)] px-2.5 py-1 text-xs hover:bg-[var(--color-field)]'

export function CuesTab({ synced, patch, rekordboxCollection }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [current, setCurrent] = useState(synced.activeCueFlow)
  const [learning, setLearning] = useState<Learning>('idle')
  const [reading, setReading] = useState(false)
  const request = useRef(0)
  const [removals, setRemovals] = useState(0)
  const flows = synced.cueFlows
  const flow = flows.find((f) => f.id === current) ?? activeCueFlow(synced)
  const put = (next: CueFlow) =>
    patch(
      'cueFlows',
      flows.map((f) => (f.id === next.id ? next : f)),
    )
  const rows = flow.rules.map((rule, position) => ({ rule, position }))
  const setRules = (rules: CueRule[]) => put({ ...flow, rules })

  const create = () => {
    const made: CueFlow = {
      id: crypto.randomUUID(),
      name: tr('settings.cueFlows.newFlowName', { n: flows.length + 1 }),
      rules: [NEW_RULE],
    }
    patch('cueFlows', [...flows, made])
    select(made.id)
  }

  const select = (id: string) => {
    setCurrent(id)
    setLearning('idle')
    request.current++
  }

  const learn = () => {
    const asked = ++request.current
    const fresh = () => asked === request.current
    setLearning('idle')
    setReading(true)
    window.api
      .rekordboxLearnFlow()
      .then((found) => {
        if (fresh()) setLearning(found ?? 'none')
      })
      .catch((e: unknown) => {
        window.api.logError(
          `rekordbox cues: learning the flow failed (${e instanceof Error ? e.message : String(e)})`,
        )
        if (fresh()) setLearning('failed')
      })
      .finally(() => setReading(false))
  }

  const adopt = (found: LearnedFlow) => {
    const made: CueFlow = {
      ...found.flow,
      id: crypto.randomUUID(),
      name: tr('settings.cueFlows.learnedName'),
    }
    patch('cueFlows', [...flows, made])
    patch('activeCueFlow', made.id)
    select(made.id)
  }

  const remove = () => {
    patch(
      'cueFlows',
      flows.filter((f) => f.id !== flow.id),
    )
    if (synced.activeCueFlow === flow.id) patch('activeCueFlow', MY_FLOW_ID)
    setCurrent(MY_FLOW_ID)
  }

  return (
    <div className="grid grid-cols-[10rem_1fr] gap-4">
      <div data-testid="cue-flows" className="flex flex-col gap-1">
        <h3 className="mb-1 text-xs font-medium text-fg-dim">{tr('settings.cueFlows.flows')}</h3>
        {flows.map((f) => (
          <button
            key={f.id}
            type="button"
            data-testid={`cue-flow-${f.id}`}
            aria-pressed={f.id === flow.id}
            onClick={() => select(f.id)}
            className={`press truncate rounded-md px-2 py-1.5 text-left text-sm ${
              f.id === flow.id ? 'bg-[var(--color-field)] text-fg' : 'text-fg-dim hover:text-fg'
            }`}
          >
            {flowName(f, tr)}
          </button>
        ))}
        <button
          type="button"
          data-testid="cue-flow-new"
          onClick={create}
          className={`${BUTTON_CLASS} mt-1`}
        >
          {tr('settings.cueFlows.newFlow')}
        </button>
        <button
          type="button"
          data-testid="cue-learn"
          disabled={!rekordboxCollection || reading}
          onClick={learn}
          className={`${BUTTON_CLASS} mt-1 inline-flex items-center gap-1.5 disabled:opacity-60`}
        >
          {reading && (
            <Loader2
              data-testid="cue-learn-spinner"
              className="h-3.5 w-3.5 shrink-0 animate-spin"
              aria-hidden="true"
            />
          )}
          {tr('settings.cueFlows.learn')}
        </button>
        {learning === 'none' && (
          <p data-testid="cue-learn-none" className="text-xs text-fg-dim">
            {tr('settings.cueFlows.learnNone')}
          </p>
        )}
        {learning === 'failed' && (
          <p data-testid="cue-learn-failed" className="text-xs text-warn">
            {tr('settings.cueFlows.learnFailed')}
          </p>
        )}
      </div>
      {typeof learning === 'object' ? (
        <div data-testid="cue-learned" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 text-sm text-fg">
              {tr('settings.cueFlows.learnedName')}
            </h3>
            <button
              type="button"
              data-testid="cue-learned-use"
              onClick={() => adopt(learning)}
              className={BUTTON_CLASS}
            >
              {tr('settings.cueFlows.use')}
            </button>
            <button
              type="button"
              data-testid="cue-learned-discard"
              onClick={() => setLearning('idle')}
              className={BUTTON_CLASS}
            >
              {tr('settings.cueFlows.discard')}
            </button>
          </div>
          <p data-testid="cue-learned-coverage" className="text-xs text-fg-dim">
            {tr('settings.cueFlows.learnedCoverage', {
              ...learning.coverage,
              count: learning.coverage.marked,
            })}
          </p>
          <CueFlowPreview flow={learning.flow} />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              data-testid="cue-flow-name"
              aria-label={tr('settings.cueFlows.name')}
              value={flow.name}
              placeholder={flowName(flow, tr)}
              onChange={(e) => put({ ...flow, name: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            {synced.activeCueFlow === flow.id ? (
              <span data-testid="cue-flow-in-use" className="text-xs text-fg-dim">
                {tr('settings.cueFlows.inUse')}
              </span>
            ) : (
              <button
                type="button"
                data-testid="cue-flow-use"
                onClick={() => patch('activeCueFlow', flow.id)}
                className={BUTTON_CLASS}
              >
                {tr('settings.cueFlows.use')}
              </button>
            )}
            {flow.id === MY_FLOW_ID ? (
              <button
                type="button"
                data-testid="cue-flow-restore"
                onClick={() => patch('cueFlows', restoreMyFlow(flows))}
                className={BUTTON_CLASS}
              >
                {tr('settings.cueFlows.restore')}
              </button>
            ) : (
              <button
                type="button"
                data-testid="cue-flow-delete"
                onClick={remove}
                className={BUTTON_CLASS}
              >
                {tr('settings.cueFlows.delete')}
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-fg-dim">{tr('settings.cueFlows.rules')}</h3>
            {rows.map(({ rule, position }) => (
              <CueRuleRow
                key={`${flow.id}-${removals}-${position}`}
                rule={rule}
                index={position}
                onChange={(next) => setRules(flow.rules.map((r, j) => (j === position ? next : r)))}
                onRemove={() => {
                  setRules(flow.rules.filter((_, j) => j !== position))
                  setRemovals(removals + 1)
                }}
              />
            ))}
            {flow.rules.length === 0 && (
              <p data-testid="cue-flow-no-rules" className="text-xs text-fg-dim">
                {tr('settings.cueFlows.noRules')}
              </p>
            )}
            <button
              type="button"
              data-testid="cue-rule-add"
              onClick={() => setRules([...flow.rules, NEW_RULE])}
              className={`${BUTTON_CLASS} self-start`}
            >
              {tr('settings.cueFlows.addRule')}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-fg-dim">{tr('settings.cueFlows.preview')}</h3>
            <CueFlowPreview flow={flow} />
          </div>
        </div>
      )}
    </div>
  )
}
