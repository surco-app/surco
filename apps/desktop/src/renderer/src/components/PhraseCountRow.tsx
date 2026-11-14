import { useTranslation } from 'react-i18next'
import { phraseCount, withPhraseCount } from '../../../shared/phraseCount'
import { useQueuedCues, useTrackCues } from '../hooks/useTrackCues'

export function PhraseCountRow({
  contentId,
  comment,
  onApply,
}: {
  contentId: string
  comment: string
  onApply: (comment: string) => void
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const { data: read } = useTrackCues(contentId)
  const { data: queued } = useQueuedCues(contentId)
  if (!read?.analysed || queued === undefined) return null
  const count = phraseCount(queued?.wanted ?? read.cues, read.grid)
  const next = count === null ? comment : withPhraseCount(comment, count)
  return (
    <div
      data-testid="phrase-count"
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--color-line)] pt-3"
    >
      <span className="text-xs text-fg-dim">{tr('editor.cues.phrases.label')}</span>
      {count === null ? (
        <span data-testid="phrase-count-needs-calls" className="text-xs text-fg-faint">
          {tr('editor.cues.phrases.needsCalls')}
        </span>
      ) : (
        <span data-testid="phrase-count-value" className="text-sm tabular-nums text-fg">
          {count}
        </span>
      )}
      <button
        type="button"
        data-testid="phrase-count-apply"
        disabled={next === comment}
        onClick={() => onApply(next)}
        className="press ml-auto rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
      >
        {tr('editor.cues.phrases.apply')}
      </button>
    </div>
  )
}
