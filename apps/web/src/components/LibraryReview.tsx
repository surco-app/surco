import { useTranslation } from 'react-i18next'
import { SCENE_ANCHORS } from '../lib/sceneAnchors'
import Reveal from './Reveal'
import { AnchorLink, Replayable } from './scenes/Replay'
import ReviewScene from './scenes/ReviewScene'
import { STEP_LABEL } from './scenes/SceneLayout'

const POINTS = ['spelling', 'typo', 'duplicate', 'everywhere'] as const

export default function LibraryReview() {
  const { t } = useTranslation()

  return (
    <section className="pt-24">
      <Reveal>
        <div id={SCENE_ANCHORS.review} className="scroll-mt-8 text-center">
          <p className={STEP_LABEL}>{t('home.review.kicker')}</p>
          <h2 className="group/title mx-auto mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            {t('home.review.title')}
            <AnchorLink id={SCENE_ANCHORS.review} />
          </h2>
          <p className="mx-auto mt-3 max-w-2xl leading-relaxed text-pretty text-muted">
            {t('home.review.lede')}
          </p>
        </div>
      </Reveal>
      <Reveal delay={120} className="mt-8">
        <Replayable>
          <ReviewScene />
        </Replayable>
      </Reveal>
      <Reveal delay={160}>
        <ol className="mt-8 grid gap-x-5 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {POINTS.map((key, i) => (
            <li key={key} className="border-t border-line pt-3">
              <p className="font-mono text-xs text-faint">{String(i + 1).padStart(2, '0')}</p>
              <p className="mt-1.5 text-sm font-semibold text-fg">
                {t(`home.review.points.${key}.title`)}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-pretty text-muted">
                {t(`home.review.points.${key}.text`)}
              </p>
            </li>
          ))}
        </ol>
      </Reveal>
    </section>
  )
}
