import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DROP_TRACKS, dropFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import AppFrame from './AppFrame'
import TrackRows from './TrackRows'

// The crate lands track by track, each one reading its tags a beat after it arrives.
// The scene used to be handed seven rows frozen on "loading" from the walkthrough,
// so the step promising "drop them in and they're there" never showed a file arrive
// or a single one finish.
export default function DropScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const progress = useSceneProgress(ref, 4000)
  const { rows, read, total } = dropFrame(progress)
  const done = progress >= 1

  return (
    <AppFrame
      pill={done ? t('home.drop.pillDone', { total }) : t('home.drop.pill', { read, total })}
      busy={!done}
      progress={(read / total) * 100}
    >
      {/* The list holds the full height from the first frame, so the panel doesn't
          grow under the reader as rows land. */}
      <div ref={ref} style={{ minHeight: `${DROP_TRACKS.length * 2.15}rem` }}>
        <TrackRows rows={rows} />
      </div>
      <p className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-faint">
        {done ? t('home.drop.caption', { total }) : t('home.drop.captionBusy', { read, total })}
      </p>
    </AppFrame>
  )
}
