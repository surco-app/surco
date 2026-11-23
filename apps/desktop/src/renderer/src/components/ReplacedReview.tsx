import { Check } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { useReviewReplaced } from '../hooks/useReplacedTracks'
import { offerShortcutUndo } from '../lib/shortcutUndo'
import { useToast } from '../lib/toastContext'

// Closes the review in every program at once, with no question: the notice's Undo (and ⌘Z
// while it is up) puts the entry back exactly as it was, so a misclick costs nothing.
// onPress runs before the review: the button is about to unmount with its row, so the
// maximized editor takes the focus back while it still can, and its keys stay with the track.
export function ReviewedButton({
  path,
  name,
  onPress,
}: {
  path: string
  name: string
  onPress?: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { review, restore } = useReviewReplaced()
  const { reportUndo } = useToast()
  const onClick = async () => {
    onPress?.()
    const before = await review(path)
    if (!before) return
    const undo = () => {
      withdraw()
      void restore(before)
    }
    const dismiss = reportUndo(tr('notices.reviewed', { name }), undo, () => withdraw())
    const withdraw = offerShortcutUndo(() => {
      dismiss()
      undo()
    })
  }
  return (
    <button
      type="button"
      data-testid="cues-reviewed"
      onClick={() => onClick().catch((error) => window.api.logError(String(error)))}
      className="press flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--color-line-strong)] px-3 text-xs font-medium text-fg hover:bg-[var(--color-hover)]"
    >
      <Check className="h-3 w-3" aria-hidden="true" />
      {tr('editor.cues.replaced.reviewed')}
    </button>
  )
}
