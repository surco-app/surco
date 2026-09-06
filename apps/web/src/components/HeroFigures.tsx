import { useTranslation } from 'react-i18next'
import { SURCO_TOTAL, TRACKS } from '../lib/race'

// The three numbers that answer "why bother", beside the headline instead of
// under it. The right half of the hero used to be empty at desktop widths while
// the price — the strongest argument this page has — sat a full scroll away in
// the closing note.
//
// The seconds and the track count come from race.ts rather than being typed in
// here, so the hero can never drift from the figure the Velocidad section
// measures.
//
// The apps count is NOT derived from MANUAL_STEPS: those are six steps, not six
// programs — several of them happen inside the same app — and rendering "6→1"
// would contradict the lede two lines above it, which says four or five. It
// lives in the locale with that copy so the two can never disagree.
export default function HeroFigures() {
  const { t } = useTranslation()

  const seconds = Math.round(SURCO_TOTAL)

  return (
    <dl className="flex flex-row gap-x-8 gap-y-5 sm:gap-x-10 lg:flex-col lg:gap-6">
      <div>
        <dt className="sr-only">{t('home.figures.appsLabel')}</dt>
        <dd className="font-mono text-2xl leading-none font-medium tracking-tight text-cyan tabular-nums">
          {t('home.figures.appsValue')}
        </dd>
        <p className="mt-1.5 text-sm text-faint">{t('home.figures.apps')}</p>
      </div>
      <div>
        <dt className="sr-only">{t('home.figures.secondsLabel')}</dt>
        <dd className="font-mono text-2xl leading-none font-medium tracking-tight text-green tabular-nums">
          {t('home.figures.seconds', { seconds })}
        </dd>
        <p className="mt-1.5 text-sm text-faint">{t('home.figures.tracks', { count: TRACKS })}</p>
      </div>
      <div>
        <dt className="sr-only">{t('home.figures.priceLabel')}</dt>
        <dd className="font-mono text-2xl leading-none font-medium tracking-tight text-purple tabular-nums">
          {t('home.figures.price')}
        </dd>
        <p className="mt-1.5 text-sm text-faint">{t('home.figures.forever')}</p>
      </div>
    </dl>
  )
}
