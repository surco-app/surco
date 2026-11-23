import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Sparkle } from 'lucide-react'
import type React from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { activeCueFlow, MANUAL_CUE_FLOW } from '../../../shared/cueFlows'
import { programOf, programsInOrder } from '../../../shared/djProgram'
import type { GridCheck } from '../../../shared/gridAudit'
import type { CommentMode } from '../../../shared/phraseCount'
import type { CueLibrary, Settings } from '../../../shared/types'
import {
  type AutoMarkTarget,
  acceptAutoMarks,
  type ClearedCues,
  clearCueDrafts,
} from '../lib/cueAutoMark'
import { forgetStaleDrafts } from '../lib/cueDrafts'
import { flowName } from '../lib/cueFlowName'
import { cueProgramOf, programsOfSave } from '../lib/cuePrograms'
import {
  draftsToSave,
  forgetAutoMark,
  forgetDrafts,
  keptDrafts,
  useAutoMarks,
  useUnsavedCueTracks,
} from '../lib/cueSession'
import { recordCueEdits } from '../lib/cueTasteEdits'
import { twinPlansOf, twinSettingsOf } from '../lib/cueTwins'
import type { PhrasedComment } from '../lib/phraseCountBatch'
import { useAppSettings } from '../lib/settingsContext'
import type { AutoMarkKind } from '../lib/triage'
import { saveAllKey } from './CuesSection'
import { GridBatchBlock } from './GridBatchBlock'
import { Select } from './Select'
import { useSplitMenu } from './SplitButton'

const LIBRARIES = programsInOrder(['rekordbox', 'traktor', 'engine', 'serato', 'virtualdj'])
const LIBRARY_NAME: Record<CueLibrary, string> = {
  rekordbox: 'rekordbox',
  traktor: 'Traktor',
  engine: 'Engine DJ',
  serato: 'Serato',
  virtualdj: 'VirtualDJ',
}

const BUTTON =
  'press inline-flex items-center gap-2 rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg disabled:opacity-40'
const PRIMARY =
  'press inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40'
const PRIMARY_BODY =
  'press -mr-px inline-flex items-center gap-2 rounded-l-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40'
const PRIMARY_BODY_RUNNING =
  'press group relative -mr-px inline-flex items-center gap-2 overflow-hidden rounded-l-lg bg-[var(--color-accent)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--color-on-accent)]'
const PRIMARY_TOGGLE =
  'press relative inline-flex items-center rounded-r-lg bg-[var(--color-accent)] px-1.5 text-[var(--color-on-accent)] before:absolute before:inset-y-1.5 before:left-0 before:w-px before:bg-[var(--color-on-accent)]/20 hover:bg-[var(--color-accent-hover)] disabled:opacity-40'
const OPTIONS_MENU =
  'animate-pop-flat absolute bottom-full left-0 z-50 mb-2 min-w-48 origin-bottom-left overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] py-1 shadow-[var(--shadow-float)]'
const OPTIONS_ITEM =
  'flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-xs hover:bg-[var(--color-panel)] focus-visible:bg-[var(--color-panel)] focus-visible:shadow-none'

// The cues slot with several tracks selected: pick the flow, Auto marcar them all, accept
// every proposal at once and save, without opening each track. Accepting leaves the cues as
// unsaved drafts, the same ones the single-track editor shows and can still adjust.
export function CuesBatchSection({
  targets,
  onMark,
  onFlow,
  gridCheckOf,
  onShowBadGrid,
  onShowMarked,
  onOpen,
  onPhrases,
  onRestoreComments,
  onRecomposeComments,
  onCommentsSaved,
  onSaveSettings,
}: {
  targets: AutoMarkTarget[]
  onMark: () => void
  onFlow: (id: string) => void
  gridCheckOf: (contentId: string) => GridCheck | null | undefined
  onShowBadGrid: () => void
  onShowMarked: (kind: AutoMarkKind) => void
  onOpen: (contentId: string) => void
  onPhrases: (
    mode: CommentMode,
  ) => Promise<{ done: number; skipped: number; comments: PhrasedComment[] }>
  onRestoreComments: (comments: PhrasedComment[]) => void
  onRecomposeComments: (comments: PhrasedComment[], mode: CommentMode) => PhrasedComment[]
  onCommentsSaved: (comments: PhrasedComment[], toFile: boolean) => void
  onSaveSettings: (patch: Partial<Settings>) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppSettings()
  const marks = useAutoMarks()
  const unsavedAll = useUnsavedCueTracks()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [phrasing, setPhrasing] = useState(false)
  const [cleared, setCleared] = useState<{ result: ClearedCues; forIds: string } | null>(null)
  const [phrased, setPhrased] = useState<{ done: number; skipped: number } | null>(null)
  const [unsavedComments, setUnsavedComments] = useState<PhrasedComment[]>([])
  const [commentsFailed, setCommentsFailed] = useState<'rekordbox' | number | null>(null)
  const commentsMenu = useSplitMenu()
  const savingNow = useRef(false)
  const progressId = useId()
  useEffect(
    () =>
      window.api.cues.onCommentProgress((p) => {
        if (savingNow.current) setProgress(p)
      }),
    [],
  )
  const mode: CommentMode = settings.commentsReplace ? 'replace' : 'prepend'
  const putPhrases = async () => {
    setPhrasing(true)
    try {
      const { comments, ...result } = await onPhrases(mode)
      setPhrased(result)
      setUnsavedComments((kept) => {
        const byId = new Map(kept.map((c) => [c.id, c]))
        for (const c of comments.filter((c) => programOf(c.contentId) === 'rekordbox'))
          byId.set(c.id, { ...c, before: byId.get(c.id)?.before ?? c.before })
        return [...byId.values()]
      })
      setCommentsFailed(null)
    } finally {
      setPhrasing(false)
    }
  }
  const saveComments = async () => {
    savingNow.current = true
    setBusy(true)
    try {
      const toFile = settings.commentsToFile
      const result = await window.api.dj
        .askToApply(['rekordbox'])
        .then(() => {
          if (toFile) setProgress({ done: 0, total: unsavedComments.length })
          return window.api.cues.saveComments(
            unsavedComments.map(({ contentId, path, label, count }) => ({
              contentId,
              path,
              label,
              count,
              mode,
            })),
            toFile,
          )
        })
        .then(
          (saved) => saved,
          () => null,
        )
      setCommentsFailed(!result ? 'rekordbox' : result.failed.length || null)
      if (!result) return
      const pending = new Set([...result.failed, ...result.unwritten])
      onCommentsSaved(
        unsavedComments.filter((c) => !pending.has(c.path)),
        toFile,
      )
      setUnsavedComments(unsavedComments.filter((c) => pending.has(c.path)))
    } finally {
      savingNow.current = false
      setProgress(null)
      setBusy(false)
    }
  }
  const pickToFile = (toFile: boolean) => {
    commentsMenu.setOpen(false)
    onSaveSettings({ commentsToFile: toFile })
  }
  const pickReplace = (replace: boolean) => {
    commentsMenu.setOpen(false)
    onSaveSettings({ commentsReplace: replace })
    setUnsavedComments(onRecomposeComments(unsavedComments, replace ? 'replace' : 'prepend'))
  }
  const commentOption = (id: string, key: string, checked: boolean, pick: () => void) => (
    <button
      type="button"
      data-testid={`cues-batch-comments-${id}`}
      role="menuitemradio"
      aria-checked={checked}
      onClick={pick}
      className={OPTIONS_ITEM}
    >
      <Check
        className={`h-3.5 w-3.5 shrink-0 text-[var(--color-accent)] ${checked ? '' : 'invisible'}`}
        strokeWidth={2.5}
        aria-hidden="true"
      />
      {tr(`editor.cues.batch.${key}`)}
    </button>
  )
  const discardComments = () => {
    onRestoreComments(unsavedComments)
    setUnsavedComments([])
    setCommentsFailed(null)
    setPhrased(null)
  }
  const ids = targets.map((t) => t.contentId)
  const idsKey = [...ids].sort().join('\n')
  const shown = cleared?.forIds === idsKey ? cleared.result : null
  const clearDiscardable = !!shown && shown.cleared.length > 0
  const gated = ids.some((id) => cueProgramOf(id).collectionGate !== null)
  const { data: canSave = true } = useQuery({
    queryKey: ['traktor-can-save', settings.traktorNmlPath],
    queryFn: () => window.api.traktorCanSave(),
    enabled: gated,
  })
  const savable = (contentId: string) => canSave || cueProgramOf(contentId).collectionGate === null
  const unsaved = new Set(ids.filter((id) => unsavedAll.has(id) && savable(id)))
  const drafts = keptDrafts().filter((d) => unsaved.has(d.contentId))
  const twinSettings = twinSettingsOf(settings)
  const { data: plans = [] } = useQuery({
    queryKey: [
      'cue-twin-plans-batch',
      drafts.map((d) => [
        d.contentId,
        d.path,
        d.label,
        d.draft.cues,
        d.draft.origin,
        d.draft.locked,
        d.draft.marked,
      ]),
      [...unsavedAll].sort(),
      twinSettings,
    ],
    queryFn: () => twinPlansOf(queryClient, drafts, twinSettings),
    enabled: drafts.length > 0,
  })
  const twins = drafts.length > 0 ? plans.filter((p) => savable(p.contentId)) : []
  const reach = LIBRARIES.map((library) => ({
    library,
    tracks:
      [...unsaved].filter((id) => programOf(id) === library).length +
      twins.filter((p) => p.library === library && p.status === 'planned').length,
    kept: twins.filter((p) => p.library === library && p.status === 'unsaved').length,
  })).filter((r) => r.tracks + r.kept > 0)
  const reachesOthers = twins.length > 0
  const ofKind = (kind: string) => ids.filter((id) => marks.get(id)?.kind === kind).length
  const proposals = ids.reduce((sum, id) => {
    const mark = marks.get(id)
    return sum + (mark?.kind === 'proposed' ? mark.proposals.length : 0)
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
  const confidence = ids.reduce(
    (sum, id) => {
      const mark = marks.get(id)
      if (mark?.kind !== 'proposed') return sum
      const sure = mark.proposals.filter((p) => p.sure).length
      return { sure: sum.sure + sure, doubtful: sum.doubtful + mark.proposals.length - sure }
    },
    { sure: 0, doubtful: 0 },
  )
  const accept = async (onlySure = false) => {
    setBusy(true)
    try {
      await acceptAutoMarks(queryClient, targets, settings, { onlySure })
    } finally {
      setBusy(false)
    }
  }
  const discard = () => {
    for (const id of ids) forgetAutoMark(id)
  }
  const clear = async () => {
    setBusy(true)
    try {
      setCleared({ result: await clearCueDrafts(queryClient, targets, settings), forIds: idsKey })
    } finally {
      setBusy(false)
    }
  }
  const discardCleared = () => {
    forgetDrafts(shown?.cleared ?? [])
    setCleared(null)
  }
  const clearedRows = shown
    ? (
        [
          ['hot', tr('editor.cues.batch.clearedHot', { count: shown.hot }), shown.hot],
          ['calls', tr('editor.cues.batch.clearedCalls', { count: shown.calls }), shown.calls],
          ['loops', tr('editor.cues.batch.clearedLoops', { count: shown.loops }), shown.loops],
          [
            'unsaved',
            tr('editor.cues.batch.clearedUnsaved', { count: shown.unsaved }),
            shown.unsaved,
          ],
        ] as const
      ).filter(([, , n]) => n > 0)
    : []
  const save = async () => {
    setBusy(true)
    try {
      await forgetStaleDrafts(queryClient)
      const wanted = new Set(ids)
      const mine = draftsToSave().filter((r) => wanted.has(r.contentId) && savable(r.contentId))
      if (mine.length === 0) return
      const mineIds = new Set(mine.map((r) => r.contentId))
      const others = await twinPlansOf(
        queryClient,
        keptDrafts().filter((d) => mineIds.has(d.contentId)),
        settings,
      )
      const reqs = [
        ...mine,
        ...others.flatMap((p) =>
          p.status === 'planned' && savable(p.contentId) ? [p.request] : [],
        ),
      ]
      const saved = await window.api.dj
        .askToApply(programsOfSave(reqs))
        .then(() => window.api.cues.save(reqs))
        .then(
          () => true,
          () => false,
        )
      setSaveFailed(!saved)
      if (!saved) return
      void recordCueEdits(
        queryClient,
        keptDrafts()
          .filter((d) => mineIds.has(d.contentId))
          .map(({ contentId, draft }) => ({ contentId, draft })),
      )
      forgetDrafts(reqs.map((r) => r.contentId))
      setCleared(null)
      await queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      data-testid="cues-multi"
      className="mt-6 border-t border-[var(--color-line)] pt-5 compact:mt-3 compact:pt-3"
    >
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
        <button
          type="button"
          data-testid="cues-batch-phrases"
          disabled={phrasing}
          onClick={() => void putPhrases()}
          className={BUTTON}
        >
          {tr('editor.cues.batch.phrases')}
        </button>
        <button
          type="button"
          data-testid="cues-batch-clear"
          disabled={busy || (shown?.cleared.length ?? 0) > 0}
          onClick={() => void clear()}
          className="press px-2 py-1.5 text-xs text-fg-dim hover:text-fg disabled:opacity-40 disabled:hover:text-fg-dim"
        >
          {tr('editor.cues.clearAll')}
        </button>
      </div>
      {phrased && (
        <p className="mt-2 text-xs text-fg-dim">
          <span data-testid="cues-batch-phrases-done">
            {tr('editor.cues.batch.phrasesDone', { count: phrased.done })}
          </span>
          {phrased.skipped > 0 && (
            <>
              {' · '}
              <span data-testid="cues-batch-phrases-skipped">
                {tr('editor.cues.batch.phrasesSkipped', { count: phrased.skipped })}
              </span>
            </>
          )}
        </p>
      )}
      {unsavedComments.length > 0 && (
        <div className="mt-3 grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div ref={commentsMenu.ref} className="relative flex">
              <button
                type="button"
                data-testid="cues-batch-comments-save"
                disabled={busy && !progress}
                aria-label={progress ? tr('common.cancel') : undefined}
                aria-describedby={progress ? progressId : undefined}
                onClick={() =>
                  progress ? void window.api.cues.cancelComments() : void saveComments()
                }
                className={progress ? PRIMARY_BODY_RUNNING : PRIMARY_BODY}
              >
                {progress && (
                  <>
                    <span
                      data-testid="cues-batch-comments-fill"
                      aria-hidden="true"
                      className="absolute inset-0 origin-left bg-[var(--color-accent)] transition-transform duration-240 ease-standard"
                      style={{
                        transform: `scaleX(${progress.total > 0 ? progress.done / progress.total : 0})`,
                      }}
                    />
                    <span aria-hidden="true" className="progress-sweep absolute inset-0" />
                  </>
                )}
                <span data-testid="cues-batch-comments-labels" className="relative grid">
                  <span
                    aria-hidden={!!progress}
                    className={`[grid-area:1/1] ${progress ? 'invisible' : ''}`}
                  >
                    {tr('editor.cues.batch.saveComments', { count: unsavedComments.length })}
                  </span>
                  <span
                    data-testid="cues-batch-comments-sizer"
                    aria-hidden="true"
                    className="invisible tabular-nums [grid-area:1/1]"
                  >
                    {tr('editor.cues.batch.savingComments', {
                      done: progress?.total ?? unsavedComments.length,
                      total: progress?.total ?? unsavedComments.length,
                    })}
                  </span>
                  <span
                    id={progressId}
                    data-testid="cues-batch-comments-progress"
                    aria-hidden={!progress}
                    className={`[grid-area:1/1] tabular-nums ${progress ? 'group-hover:invisible group-focus-visible:invisible' : 'invisible'}`}
                  >
                    {progress &&
                      tr('editor.cues.batch.savingComments', {
                        done: progress.done,
                        total: progress.total,
                      })}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`[grid-area:1/1] invisible ${progress ? 'group-hover:visible group-focus-visible:visible' : ''}`}
                  >
                    {tr('common.cancel')}
                  </span>
                </span>
              </button>
              <button
                type="button"
                data-testid="cues-batch-comments-options"
                ref={commentsMenu.toggleRef}
                disabled={busy}
                aria-label={tr('editor.cues.batch.commentsWhere')}
                aria-haspopup="menu"
                aria-expanded={commentsMenu.open}
                onClick={() => commentsMenu.setOpen((v) => !v)}
                className={PRIMARY_TOGGLE}
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              {commentsMenu.open && (
                <div
                  ref={commentsMenu.menuRef}
                  role="menu"
                  aria-label={tr('editor.cues.batch.commentsWhere')}
                  onKeyDown={commentsMenu.onMenuKeyDown}
                  className={OPTIONS_MENU}
                >
                  <fieldset className="min-w-0">
                    {commentOption('to-file', 'commentsToFile', settings.commentsToFile, () =>
                      pickToFile(true),
                    )}
                    {commentOption(
                      'rekordbox-only',
                      'commentsRekordboxOnly',
                      !settings.commentsToFile,
                      () => pickToFile(false),
                    )}
                  </fieldset>
                  <fieldset className="mt-1 min-w-0 border-t border-[var(--color-line)] pt-1">
                    {commentOption('prepend', 'commentsPrepend', mode === 'prepend', () =>
                      pickReplace(false),
                    )}
                    {commentOption('replace', 'commentsReplace', mode === 'replace', () =>
                      pickReplace(true),
                    )}
                  </fieldset>
                </div>
              )}
            </div>
            <button
              type="button"
              data-testid="cues-batch-comments-discard"
              disabled={busy}
              onClick={discardComments}
              className="press px-2 py-1.5 text-xs text-fg-dim hover:text-fg disabled:opacity-40 disabled:hover:text-fg-dim"
            >
              {tr('editor.cues.batch.clearDiscard')}
            </button>
          </div>
          {commentsFailed !== null && (
            <p data-testid="cues-batch-comments-failed" className="text-xs text-warn">
              {commentsFailed === 'rekordbox'
                ? tr('editor.cues.saveFailed')
                : tr('editor.cues.batch.commentsFileFailed', { count: commentsFailed })}
            </p>
          )}
        </div>
      )}
      {marked && (
        <div data-testid="cues-batch-tally" className="mt-3 grid gap-1 text-xs">
          {tally
            .filter(([, , n]) => n > 0)
            .map(([kind, label, n]) => (
              <button
                key={kind}
                type="button"
                data-testid={`cues-batch-tally-${kind}`}
                onClick={() => onShowMarked(kind)}
                className="press flex justify-between gap-4 text-left text-fg-dim"
              >
                <span>{label}</span>
                <span className="tabular-nums text-fg">{n}</span>
              </button>
            ))}
        </div>
      )}
      {clearedRows.length > 0 && (
        <dl data-testid="cues-batch-cleared" className="mt-3 grid gap-1 text-xs">
          {clearedRows.map(([kind, label]) => (
            <div key={kind} data-testid={`cues-batch-cleared-${kind}`}>
              <dt className={kind === 'unsaved' ? 'text-warn' : 'text-fg-dim'}>{label}</dt>
            </div>
          ))}
        </dl>
      )}
      {confidence.sure > 0 && confidence.doubtful > 0 && (
        <p data-testid="cues-batch-confidence" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.batch.confidence', {
            sure: tr('editor.cues.batch.sure', { count: confidence.sure }),
            doubtful: tr('editor.cues.batch.doubtful', { count: confidence.doubtful }),
          })}
        </p>
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
          {confidence.sure > 0 && confidence.doubtful > 0 && (
            <button
              type="button"
              data-testid="cues-batch-accept-sure"
              disabled={busy}
              onClick={() => void accept(true)}
              className="press rounded-lg border border-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-hover)] disabled:opacity-40"
            >
              {tr('editor.cues.batch.acceptSure', { count: confidence.sure })}
            </button>
          )}
          <button
            type="button"
            data-testid="cues-batch-discard"
            onClick={discard}
            className="press px-2 py-1.5 text-xs text-fg-dim hover:text-fg"
          >
            {tr('editor.cues.auto.discard', { count: proposals })}
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
      {(unsaved.size > 0 || clearDiscardable) && (
        <div className="mt-3 grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {unsaved.size > 0 && (
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
            )}
            {clearDiscardable && (
              <button
                type="button"
                data-testid="cues-batch-clear-discard"
                onClick={discardCleared}
                className="press px-2 py-1.5 text-xs text-fg-dim hover:text-fg"
              >
                {tr('editor.cues.batch.clearDiscard')}
              </button>
            )}
          </div>
          {saveFailed && (
            <p data-testid="cues-batch-save-failed" className="text-xs text-warn">
              {tr('editor.cues.saveFailed')}
            </p>
          )}
        </div>
      )}
      <GridBatchBlock
        targets={targets}
        checkOf={gridCheckOf}
        onShowInList={onShowBadGrid}
        onOpen={onOpen}
      />
    </div>
  )
}
