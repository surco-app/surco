import { useTranslation } from 'react-i18next'
import Kicker from './Kicker'
import Reveal from './Reveal'
import ReviewScene from './scenes/ReviewScene'

const POINTS = ['spelling', 'typo', 'duplicate', 'everywhere'] as const

export default function LibraryReview() {
  const { t } = useTranslation()

  return (
    <section className="pt-24">
      <Reveal>
        <div id="biblioteca" className="scroll-mt-8">
          <Kicker>{t('home.review.kicker')}</Kicker>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t('home.review.title')}
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">
            {t('home.review.lede')}
          </p>
        </div>
      </Reveal>
      <Reveal delay={120} className="mt-8">
        <ReviewScene />
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
