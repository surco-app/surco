import { useTranslation } from 'react-i18next'
import { SCENE_ANCHORS } from '../lib/sceneAnchors'
import Reveal from './Reveal'
import { AnchorLink, Replayable } from './scenes/Replay'
import ReviewScene from './scenes/ReviewScene'

const POINTS = ['spelling', 'typo', 'duplicate', 'everywhere'] as const

export default function LibraryReview() {
  const { t } = useTranslation()

  return (
    <section className="pt-24">
      <Reveal>
        <div id={SCENE_ANCHORS.review} className="scroll-mt-8 text-center">
          <h2 className="group/title mx-auto max-w-2xl text-[min(1.875rem,6.15vw)] font-semibold tracking-tight text-balance sm:text-5xl">
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
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {POINTS.map((key) => (
            <li key={key} className="rounded-xl bg-surface p-5">
              <p className="text-sm font-semibold text-fg">
                {t(`home.review.points.${key}.title`)}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-pretty text-muted">
                {t(`home.review.points.${key}.text`)}
              </p>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  )
}
