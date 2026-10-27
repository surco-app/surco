import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkle } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { activeCueFlow, MANUAL_CUE_FLOW } from '../../../shared/cueFlows'
import { isTraktorContent } from '../../../shared/traktorContent'
import type { CueLibrary } from '../../../shared/types'
import { type AutoMarkTarget, acceptAutoMarks } from '../lib/cueAutoMark'
import { forgetStaleDrafts } from '../lib/cueDrafts'
import { flowName } from '../lib/cueFlowName'
import {
  draftsToSave,
  forgetAutoMark,
  forgetDraft,
  keptDrafts,
  useAutoMarks,
  useUnsavedCueTracks,
} from '../lib/cueSession'
import { libraryOf, twinPlansOf } from '../lib/cueTwins'
import { useAppSettings } from '../lib/settingsContext'
import { saveAllKey } from './CuesSection'
import { Select } from './Select'

const LIBRARIES: CueLibrary[] = ['rekordbox', 'traktor', 'engine']
const LIBRARY_NAME: Record<CueLibrary, string> = {
  rekordbox: 'rekordbox',
  traktor: 'Traktor',
  engine: 'Engine DJ',
}

const BUTTON =
  'press inline-flex items-center gap-2 rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg disabled:opacity-40'
const PRIMARY =
  'press inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40'

// The cues slot with several tracks selected: pick the flow, Auto marcar them all, accept
// every proposal at once and save, without opening each track. Accepting leaves the cues as
// unsaved drafts, the same ones the single-track editor shows and can still adjust.
export function CuesBatchSection({
  targets,
  onMark,
  onFlow,
}: {
  targets: AutoMarkTarget[]
  onMark: () => void
  onFlow: (id: string) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppSettings()
  const marks = useAutoMarks()
  const unsavedAll = useUnsavedCueTracks()
  const [busy, setBusy] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const ids = targets.map((t) => t.contentId)
  const traktor = ids.some(isTraktorContent)
  const { data: canSave = true } = useQuery({
    queryKey: ['traktor-can-save', settings.traktorNmlPath],
    queryFn: () => window.api.traktorCanSave(),
    enabled: traktor,
  })
  const savable = (contentId: string) => canSave || !isTraktorContent(contentId)
  const unsaved = new Set(ids.filter((id) => unsavedAll.has(id) && savable(id)))
  const drafts = keptDrafts().filter((d) => unsaved.has(d.contentId))
  const { data: plans = [] } = useQuery({
    queryKey: [
      'cue-twin-plans-batch',
      drafts.map((d) => [d.contentId, d.draft.cues]),
      [...unsavedAll].sort(),
      settings.cueFlowToRekordbox,
      settings.cueFlowToTraktor,
      settings.cueFlowToEngine,
    ],
    queryFn: () => twinPlansOf(queryClient, drafts, settings),
    enabled: drafts.length > 0,
  })
  const twins = drafts.length > 0 ? plans.filter((p) => savable(p.contentId)) : []
  const reach = LIBRARIES.map((library) => ({
    library,
    tracks:
      [...unsaved].filter((id) => libraryOf(id) === library).length +
      twins.filter((p) => p.library === library && p.status === 'planned').length,
    kept: twins.filter((p) => p.library === library && p.status === 'unsaved').length,
  })).filter((r) => r.tracks + r.kept > 0)
  const reachesOthers = twins.length > 0
  const ofKind = (kind: string) => ids.filter((id) => marks.get(id)?.kind === kind).length
  const proposals = ids.reduce((sum, id) => {
    const mark = marks.get(id)
    return sum + (mark?.kind === 'proposed' ? mark.ms.length : 0)
  }, 0)
  const tally = [
    ['proposed', tr('editor.cues.batch.withProposals'), ofKind('proposed')],
    ['marked', tr('trackList.autoMark.marked'), ofKind('marked')],
    ['none', tr('trackList.autoMark.none'), ofKind('none')],
    ['unanalysed', tr('trackList.autoMark.unanalysed'), ofKind('unanalysed')],
  ] as const
  const marked = tally.some(([, , n]) => n > 0)
  const manual = settings.activeCueFlow === MANUAL_CUE_FLOW
  const flowOptions = [
    ...settings.cueFlows.map((f) => ({ value: f.id, label: flowName(f, tr) })),
    { value: MANUAL_CUE_FLOW, label: tr('editor.cues.manualMode'), divided: true },
  ]
  const accept = async () => {
    setBusy(true)
    try {
      await acceptAutoMarks(queryClient, targets, settings)
    } finally {
      setBusy(false)
    }
  }
  const discard = () => {
    for (const id of ids) forgetAutoMark(id)
  }
  const save = async () => {
    setBusy(true)
    try {
      await forgetStaleDrafts(queryClient)
      const mine = draftsToSave().filter((r) => ids.includes(r.contentId) && savable(r.contentId))
      if (mine.length === 0) return
      const others = await twinPlansOf(
        queryClient,
        keptDrafts().filter((d) => mine.some((r) => r.contentId === d.contentId)),
        settings,
      )
      const reqs = [
        ...mine,
        ...others.flatMap((p) =>
          p.status === 'planned' && savable(p.contentId) ? [p.request] : [],
        ),
      ]
      const saved = await window.api.saveRekordboxCues(reqs).then(
        () => true,
        () => false,
      )
      setSaveFailed(!saved)
      if (!saved) return
      for (const req of reqs) forgetDraft(req.contentId)
      await queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-testid="cues-multi" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <p className="text-sm font-medium text-fg-muted">{tr('editor.cues.title')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          testid="cues-batch-flow"
          portal
          lead={tr('editor.cues.flow')}
          label={tr('editor.cues.flow')}
          value={manual ? MANUAL_CUE_FLOW : activeCueFlow(settings).id}
          onChange={onFlow}
          options={flowOptions}
        />
        <button type="button" data-testid="cues-auto-mark-all" onClick={onMark} className={BUTTON}>
          <Sparkle className="h-3.5 w-3.5" aria-hidden="true" />
          {tr('editor.cues.batch.mark', { count: targets.length })}
        </button>
      </div>
      {marked && (
        <dl data-testid="cues-batch-tally" className="mt-3 grid gap-1 text-xs">
          {tally
            .filter(([, , n]) => n > 0)
            .map(([kind, label, n]) => (
              <div key={kind} className="flex justify-between gap-4 text-fg-dim">
                <dt>{label}</dt>
                <dd className="tabular-nums text-fg">{n}</dd>
              </div>
            ))}
        </dl>
      )}
      {proposals > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="cues-batch-accept"
            disabled={busy}
            onClick={() => void accept()}
            className={PRIMARY}
          >
            {tr('editor.cues.auto.accept', { count: proposals })}
          </button>
          <button
            type="button"
            data-testid="cues-batch-discard"
            onClick={discard}
            className="press px-2 py-1.5 text-xs text-fg-dim hover:text-fg"
          >
            {tr('editor.cues.auto.discard')}
          </button>
        </div>
      )}
      {reachesOthers && (
        <div
          data-testid="cues-batch-twins"
          className="mt-3 rounded-lg border border-[var(--color-line)] text-xs"
        >
          <p className="px-3 pt-2.5 pb-1.5 text-fg-dim">{tr('editor.cues.batch.twinsTitle')}</p>
          <dl>
            {reach.map(({ library, tracks, kept }) => (
              <div
                key={library}
                data-testid={`cues-batch-twin-${library}`}
                className="grid grid-cols-[5.5rem_3rem_minmax(0,1fr)] items-baseline gap-2 border-t border-[var(--color-line)] px-3 py-2"
              >
                <dt className="text-fg">{LIBRARY_NAME[library]}</dt>
                <dd className="tabular-nums text-fg">{tracks}</dd>
                <dd className="text-warn">
                  {kept > 0 && tr('editor.cues.batch.twinsUnsaved', { count: kept })}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {unsaved.size > 0 && (
        <div className="mt-3 grid gap-2">
          <button
            type="button"
            data-testid="cues-batch-save"
            disabled={busy}
            onClick={() => void save()}
            className={PRIMARY}
          >
            {tr(reachesOthers ? 'editor.cues.saveAllMixed' : saveAllKey(unsaved), {
              count: unsaved.size,
            })}
          </button>
          {saveFailed && (
            <p data-testid="cues-batch-save-failed" className="text-xs text-warn">
              {tr('editor.cues.saveFailed')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
