import { Loader2 } from 'lucide-react'
import type React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  activeCueFlow,
  type CueFlow,
  type CueRule,
  DEFAULT_CUE_FLOW_ID,
  isBundledFlow,
  MANUAL_CUE_FLOW,
  restoreDefaultFlow,
} from '../../../../shared/cueFlows'
import { CUE_JUMP_BARS } from '../../../../shared/cueJump'
import { CUE_QUANTIZE } from '../../../../shared/cueQuantize'
import type { LearnedFlow } from '../../../../shared/learnFlow'
import { flowName } from '../../lib/cueFlowName'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { CueFlowPreview } from '../CueFlowPreview'
import { CueRuleRow } from '../CueRuleRow'
import { CheckboxRow } from './CheckboxRow'
import { SettingsHint } from './SettingsPrimitives'

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
  const [typed, setTyped] = useState<string | null>(null)
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
      markPoint: true,
      rules: [NEW_RULE],
    }
    patch('cueFlows', [...flows, made])
    select(made.id)
  }

  const select = (id: string) => {
    setCurrent(id)
    setTyped(null)
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
    if (synced.activeCueFlow === flow.id) patch('activeCueFlow', DEFAULT_CUE_FLOW_ID)
    setCurrent(DEFAULT_CUE_FLOW_ID)
  }

  const inUse = synced.activeCueFlow === MANUAL_CUE_FLOW ? null : activeCueFlow(synced).id
  return (
    <div className="flex flex-col gap-5">
      <fieldset
        data-testid="cue-flows"
        aria-label={tr('settings.cueFlows.flows')}
        className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
      >
        {flows.map((f) =>
          f.id === flow.id && typeof learning !== 'object' ? (
            <span
              key={f.id}
              data-testid={`cue-flow-${f.id}`}
              aria-current="true"
              className="inline-flex items-center rounded-full border border-[var(--color-accent)] bg-[var(--color-field)] px-3 py-1 text-sm text-fg"
            >
              <input
                data-testid="cue-flow-name"
                aria-label={tr('settings.cueFlows.name')}
                value={typed ?? flowName(flow, tr)}
                placeholder={flowName(flow, tr)}
                size={Math.max(4, (typed ?? flowName(flow, tr)).length + 1)}
                onFocus={() => setTyped((now) => now ?? flowName(flow, tr))}
                onBlur={() => setTyped(null)}
                onChange={(e) => {
                  setTyped(e.target.value)
                  put({ ...flow, name: e.target.value })
                }}
                className="min-w-0 bg-transparent outline-none placeholder:text-fg"
              />
              {inUse === f.id && (
                <span data-testid="cue-flow-in-use" className="text-fg-dim">
                  {` · ${tr('settings.cueFlows.inUse')}`}
                </span>
              )}
            </span>
          ) : (
            <button
              key={f.id}
              type="button"
              data-testid={`cue-flow-${f.id}`}
              aria-pressed={false}
              onClick={() => select(f.id)}
              className="press rounded-full border border-[var(--color-line-strong)] px-3 py-1 text-sm text-fg-dim hover:text-fg"
            >
              {flowName(f, tr)}
              {inUse === f.id && (
                <span data-testid="cue-flow-in-use">{` · ${tr('settings.cueFlows.inUse')}`}</span>
              )}
            </button>
          ),
        )}
        <button
          type="button"
          data-testid="cue-flow-new"
          onClick={create}
          className="press rounded-full border border-dashed border-[var(--color-line-strong)] px-3 py-1 text-sm text-fg-dim hover:text-fg"
        >
          {`+ ${tr('settings.cueFlows.newFlow')}`}
        </button>
        <button
          type="button"
          data-testid="cue-learn"
          disabled={!rekordboxCollection || reading}
          onClick={learn}
          className="press inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--color-line-strong)] px-3 py-1 text-sm text-fg-dim hover:text-fg disabled:opacity-60"
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
      </fieldset>
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
        <>
          <section aria-label={tr('settings.cueFlows.preview')}>
            <CueFlowPreview flow={flow} />
          </section>
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
            <CheckboxRow
              testid="cue-flow-mark-point"
              checked={flow.markPoint}
              onChange={(markPoint) => put({ ...flow, markPoint })}
              label={tr('settings.cueFlows.markPoint')}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="cue-rule-add"
                onClick={() => setRules([...flow.rules, NEW_RULE])}
                className={BUTTON_CLASS}
              >
                {`+ ${tr('settings.cueFlows.addRule')}`}
              </button>
              <span className="flex-1" />
              {inUse !== flow.id && (
                <button
                  type="button"
                  data-testid="cue-flow-use"
                  onClick={() => patch('activeCueFlow', flow.id)}
                  className={BUTTON_CLASS}
                >
                  {tr('settings.cueFlows.use')}
                </button>
              )}
              {isBundledFlow(flow.id) ? (
                <button
                  type="button"
                  data-testid="cue-flow-restore"
                  onClick={() => patch('cueFlows', restoreDefaultFlow(flows, flow.id))}
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
          </div>
        </>
      )}
      <div
        data-testid="cue-manual"
        className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-line)] px-3.5 py-3 text-sm"
      >
        <span className="font-semibold">{tr('settings.cueFlows.manual.title')}</span>
        <span className="text-fg-dim">{tr('settings.cueFlows.manual.jump')}</span>
        <fieldset
          aria-label={tr('settings.cueFlows.manual.jump')}
          className="m-0 flex min-w-0 overflow-hidden rounded-md border border-[var(--color-line-strong)] p-0"
        >
          {CUE_JUMP_BARS.map((bars) => (
            <button
              key={bars}
              type="button"
              data-testid={`cue-jump-${bars}`}
              aria-pressed={synced.cueJumpBars === bars}
              onClick={() => patch('cueJumpBars', bars)}
              className={`press px-2.5 py-1 font-mono text-xs ${
                synced.cueJumpBars === bars
                  ? 'bg-[var(--color-field)] text-fg'
                  : 'text-fg-dim hover:text-fg'
              }`}
            >
              {bars}
            </button>
          ))}
        </fieldset>
        <span className="text-fg-dim">{tr('settings.cueFlows.manual.unit')}</span>
        <span className="text-fg-dim">{tr('settings.cueFlows.manual.quantize')}</span>
        <fieldset
          aria-label={tr('settings.cueFlows.manual.quantize')}
          className="m-0 flex min-w-0 overflow-hidden rounded-md border border-[var(--color-line-strong)] p-0"
        >
          {CUE_QUANTIZE.map((unit) => (
            <button
              key={unit}
              type="button"
              data-testid={`cue-quantize-${unit}`}
              aria-pressed={synced.cueQuantize === unit}
              onClick={() => patch('cueQuantize', unit)}
              className={`press px-2.5 py-1 text-xs ${
                synced.cueQuantize === unit
                  ? 'bg-[var(--color-field)] text-fg'
                  : 'text-fg-dim hover:text-fg'
              }`}
            >
              {unit === 'bar' ? tr('editor.cues.quantizeBar') : tr('editor.cues.quantizeBeat')}
            </button>
          ))}
        </fieldset>
      </div>
      <div
        data-testid="cue-letters"
        className="rounded-md border border-[var(--color-line)] px-3.5 py-3 text-sm"
      >
        <CheckboxRow
          testid="settings-cue-letters-by-time"
          checked={synced.cueLettersByTime}
          onChange={(v) => patch('cueLettersByTime', v)}
          label={tr('settings.cueFlows.lettersByTime')}
        />
        <SettingsHint data-testid="settings-cue-letters-hint" className="mt-1 pl-7">
          {tr('settings.cueFlows.lettersByTimeHint')}
        </SettingsHint>
      </div>
    </div>
  )
}
