import { Check, ChevronDown, Ellipsis, Info, Plus } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
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
import { flowName } from '../../lib/cueFlowName'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { CueFlowPreview } from '../CueFlowPreview'
import { CueRuleRow } from '../CueRuleRow'
import { SegmentedControl } from '../SegmentedControl'
import { SPLIT_ITEM, useSplitMenu } from '../SplitButton'
import { Tooltip } from '../Tooltip'
import { CheckboxRow } from './CheckboxRow'
import { CueProfileCard } from './CueProfileCard'
import { SettingsHint } from './SettingsPrimitives'

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
  rekordboxCollection: string
}

const NEW_RULE: CueRule = {
  from: 'drop',
  direction: 'back',
  bars: 16,
  repeat: 1,
  when: 'fits',
  place: 'both',
  color: { fixed: 1 },
}

const HEADING = 'text-[13px] font-semibold text-fg-muted'
const ICON_BUTTON =
  'press flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] text-fg hover:bg-[var(--color-line-strong)] aria-expanded:bg-[var(--color-accent-soft)] aria-expanded:text-[var(--color-accent)]'
const DROP_MENU =
  'animate-pop-flat absolute top-full z-50 mt-1 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] py-1 shadow-[var(--shadow-float)]'
const GROUP = 'divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)]'

export function CuesTab({ synced, patch, rekordboxCollection }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [current, setCurrent] = useState(synced.activeCueFlow)
  const [removals, setRemovals] = useState(0)
  const [typed, setTyped] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const picker = useSplitMenu()
  const more = useSplitMenu()
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!renaming) return
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [renaming])
  // The rules serve every library, but CALLs only exist in rekordbox and Traktor paints a
  // cue by its type: where Engine DJ or Traktor is installed, the tab says what reaches them.
  const [traktorFound, setTraktorFound] = useState(false)
  const [engineFound, setEngineFound] = useState(false)
  useEffect(() => {
    void window.api.traktorAvailable().then(setTraktorFound, () => {})
    void window.api.engineAvailable().then(setEngineFound, () => {})
  }, [])
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
    rename(made.name)
  }

  const rename = (name: string) => {
    setTyped(name)
    setRenaming(true)
  }

  const endRename = () => {
    setTyped(null)
    setRenaming(false)
  }

  const select = (id: string) => {
    setCurrent(id)
    endRename()
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
      <CueProfileCard synced={synced} patch={patch} onAdopt={select} />
      <div className="flex flex-col gap-2" data-search-id="cueFlows.flows">
        <h3 className={HEADING}>{tr('settings.cueFlows.flows')}</h3>
        <div className="flex items-center gap-2">
          {renaming ? (
            <input
              data-testid="cue-flow-name"
              aria-label={tr('settings.cueFlows.name')}
              ref={nameRef}
              value={typed ?? flowName(flow, tr)}
              placeholder={flowName(flow, tr)}
              onBlur={endRename}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== 'Escape') return
                e.preventDefault()
                e.stopPropagation()
                endRename()
              }}
              onChange={(e) => {
                setTyped(e.target.value)
                put({ ...flow, name: e.target.value })
              }}
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--color-accent)] bg-[var(--color-field)] px-3 text-sm text-fg outline-none"
            />
          ) : (
            <div ref={picker.ref} className="relative min-w-0 flex-1">
              <button
                type="button"
                data-testid="cue-flow-picker"
                ref={picker.toggleRef}
                aria-haspopup="menu"
                aria-expanded={picker.open}
                onClick={() => picker.setOpen((v) => !v)}
                className="press flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] pr-2.5 pl-3 text-left text-sm text-fg"
              >
                <span className="min-w-0 flex-1 truncate">{flowName(flow, tr)}</span>
                {inUse === flow.id && (
                  <span className="shrink-0 text-xs text-fg-dim">
                    {tr('settings.cueFlows.inUse')}
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-dim" aria-hidden="true" />
              </button>
              {picker.open && (
                <div
                  ref={picker.menuRef}
                  role="menu"
                  aria-label={tr('settings.cueFlows.flows')}
                  onKeyDown={picker.onMenuKeyDown}
                  className={`${DROP_MENU} right-0 left-0`}
                >
                  {flows.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={f.id === flow.id}
                      data-testid={`cue-flow-${f.id}`}
                      onClick={() => {
                        picker.setOpen(false)
                        select(f.id)
                      }}
                      className={`${SPLIT_ITEM} justify-start gap-2`}
                    >
                      <Check
                        className={`h-3.5 w-3.5 shrink-0 ${f.id === flow.id ? '' : 'invisible'}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{flowName(f, tr)}</span>
                      {inUse === f.id && (
                        <span
                          data-testid="cue-flow-in-use"
                          className="shrink-0 text-xs text-fg-dim"
                        >
                          {tr('settings.cueFlows.inUse')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            data-testid="cue-flow-add"
            aria-label={tr('settings.cueFlows.newFlow')}
            title={tr('settings.cueFlows.newFlow')}
            onClick={create}
            className={ICON_BUTTON}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <div ref={more.ref} className="relative">
            <button
              type="button"
              data-testid="cue-flow-more"
              ref={more.toggleRef}
              aria-label={tr('settings.cueFlows.moreActions')}
              aria-haspopup="menu"
              aria-expanded={more.open}
              onClick={() => more.setOpen((v) => !v)}
              className={ICON_BUTTON}
            >
              <Ellipsis className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {more.open && (
              <div
                ref={more.menuRef}
                role="menu"
                aria-label={tr('settings.cueFlows.moreActions')}
                onKeyDown={more.onMenuKeyDown}
                className={`${DROP_MENU} right-0 w-60`}
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="cue-flow-use"
                  disabled={inUse === flow.id}
                  onClick={() => {
                    more.setOpen(false)
                    patch('activeCueFlow', flow.id)
                  }}
                  className={`${SPLIT_ITEM} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {tr('settings.cueFlows.use')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="cue-flow-rename"
                  onClick={() => {
                    more.setOpen(false)
                    rename(flowName(flow, tr))
                  }}
                  className={SPLIT_ITEM}
                >
                  {tr('settings.cueFlows.rename')}
                </button>
                {isBundledFlow(flow.id) ? (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="cue-flow-restore"
                    onClick={() => {
                      more.setOpen(false)
                      patch('cueFlows', restoreDefaultFlow(flows, flow.id))
                    }}
                    className={`${SPLIT_ITEM} mt-1 border-t border-[var(--color-line)]`}
                  >
                    {tr('settings.cueFlows.restore')}
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="cue-flow-delete"
                    onClick={() => {
                      more.setOpen(false)
                      remove()
                    }}
                    className={`${SPLIT_ITEM} mt-1 border-t border-[var(--color-line)] text-danger`}
                  >
                    {tr('settings.cueFlows.delete')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <section aria-label={tr('settings.cueFlows.preview')}>
        <CueFlowPreview flow={flow} />
      </section>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={HEADING}>{tr('settings.cueFlows.rules')}</h3>
          <button
            type="button"
            data-testid="cue-rule-add"
            onClick={() => setRules([...flow.rules, NEW_RULE])}
            className="press text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          >
            {`+ ${tr('settings.cueFlows.addRule')}`}
          </button>
        </div>
        <div className={GROUP}>
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
            <p data-testid="cue-flow-no-rules" className="px-3.5 py-3 text-xs text-fg-dim">
              {tr('settings.cueFlows.noRules')}
            </p>
          )}
          <div className="px-3.5 py-2.5 text-sm">
            <CheckboxRow
              testid="cue-flow-mark-point"
              checked={flow.markPoint}
              onChange={(markPoint) => put({ ...flow, markPoint })}
              label={tr('settings.cueFlows.markPoint')}
            />
          </div>
        </div>
        {(engineFound || traktorFound) && (
          <SettingsHint data-testid="cue-flow-library-note">
            {[
              tr('settings.cueFlows.callsOnlyRekordbox'),
              ...(traktorFound ? [tr('settings.cueFlows.traktorColours')] : []),
            ].join('. ')}
          </SettingsHint>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className={`${HEADING} flex items-center gap-1.5`}>
          {tr('settings.cueFlows.targets.title')}
          <span
            data-testid="cue-flow-targets-help"
            role="note"
            className="relative flex h-5 w-5 items-center justify-center text-fg-dim hover:text-fg-muted"
          >
            <Info className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">{tr('settings.cueFlows.targets.hint')}</span>
            <Tooltip label={tr('settings.cueFlows.targets.hint')} />
          </span>
        </h3>
        <div data-testid="cue-flow-targets" className={`${GROUP} text-sm`}>
          {(
            [
              ['rekordbox', 'rekordbox', 'cueFlowToRekordbox', rekordboxCollection !== ''],
              ['traktor', 'Traktor', 'cueFlowToTraktor', traktorFound],
              ['engine', 'Engine DJ', 'cueFlowToEngine', engineFound],
            ] as const
          ).map(([library, name, key, found]) => (
            <div key={library} className="px-3.5 py-2.5">
              <CheckboxRow
                testid={`settings-cue-flow-to-${library}`}
                checked={found && synced[key]}
                onChange={(v) => patch(key, v)}
                label={name}
                disabled={!found}
              />
              <SettingsHint
                data-testid={found ? undefined : `settings-cue-flow-to-${library}-missing`}
                className="mt-1 pl-7"
              >
                {found
                  ? tr(`settings.cueFlows.targets.${library}`)
                  : tr('settings.cueFlows.targets.missing', { program: name })}
              </SettingsHint>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className={HEADING}>{tr('settings.cueFlows.manual.title')}</h3>
        <div data-testid="cue-manual" className={`${GROUP} text-sm`}>
          <div
            data-search-id="cueFlows.manual.jump"
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-fg">{tr('settings.cueFlows.manual.jump')}</p>
              <p className="text-xs text-fg-dim">{tr('settings.cueFlows.manual.unit')}</p>
            </div>
            <SegmentedControl
              compact
              options={CUE_JUMP_BARS.map(String)}
              value={String(synced.cueJumpBars)}
              onChange={(bars) =>
                patch(
                  'cueJumpBars',
                  CUE_JUMP_BARS.find((b) => String(b) === bars) ?? synced.cueJumpBars,
                )
              }
              testidPrefix="cue-jump"
              labelFor={(bars) => bars}
              label={tr('settings.cueFlows.manual.jump')}
            />
          </div>
          <div
            data-search-id="cueFlows.manual.quantize"
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-2.5"
          >
            <p className="min-w-0 text-fg">{tr('settings.cueFlows.manual.quantize')}</p>
            <SegmentedControl
              compact
              options={CUE_QUANTIZE}
              value={synced.cueQuantize}
              onChange={(unit) => patch('cueQuantize', unit)}
              testidPrefix="cue-quantize"
              labelFor={(unit) =>
                unit === 'bar' ? tr('editor.cues.quantizeBar') : tr('editor.cues.quantizeBeat')
              }
              label={tr('settings.cueFlows.manual.quantize')}
            />
          </div>
          <div
            data-testid="cue-letters"
            data-search-id="cueFlows.lettersByTime"
            className="px-3.5 py-2.5"
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
      </div>
    </div>
  )
}
