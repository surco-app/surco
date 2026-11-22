import { Check, MessageSquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { phraseCount, withPhraseCount } from '../../../shared/phraseCount'
import { useQueuedCues, useTrackCues } from '../hooks/useTrackCues'
import { Tooltip } from './Tooltip'

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
  const done = count !== null && next === comment
  return (
    <div data-testid="phrase-count" className="mt-3 flex min-h-7 items-center gap-3">
      <span className="shrink-0 text-xs text-fg-dim">{tr('editor.cues.phrases.label')}</span>
      {count === null ? (
        <span
          data-testid="phrase-count-needs-calls"
          className="min-w-0 truncate text-xs text-fg-faint"
        >
          {tr('editor.cues.phrases.needsCalls')}
        </span>
      ) : (
        <span
          data-testid="phrase-count-value"
          className="min-w-0 truncate text-sm tabular-nums text-fg"
        >
          {count}
        </span>
      )}
      <button
        type="button"
        data-testid="phrase-count-apply"
        aria-label={tr('editor.cues.phrases.apply')}
        disabled={next === comment}
        onClick={() => onApply(next)}
        className={`press relative ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
          done
            ? 'text-[var(--color-good)]'
            : 'text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg disabled:opacity-40'
        }`}
      >
        {done ? (
          <Check data-testid="phrase-count-done" className="h-4 w-4" aria-hidden="true" />
        ) : (
          <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
        )}
        <Tooltip label={tr('editor.cues.phrases.apply')} />
      </button>
    </div>
  )
}
