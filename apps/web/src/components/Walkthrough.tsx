import { useTranslation } from 'react-i18next'
import { PAGES } from '../lib/nav'
import Kicker from './Kicker'
import Reveal from './Reveal'
import AppFrame from './scenes/AppFrame'
import BatchScene from './scenes/BatchScene'
import DeclickScene from './scenes/DeclickScene'
import NormalizeScene from './scenes/NormalizeScene'
import SceneLayout from './scenes/SceneLayout'
import SpectrumPair from './scenes/SpectrumPair'
import TagScene from './scenes/TagScene'
import TrackRows from './scenes/TrackRows'
import TrimScene from './scenes/TrimScene'

// The seven steps a file goes through, in order, each one showing the part of the app
// that does it. The page sells the whole preparation flow, so it walks the flow
// rather than listing features — and the app is on screen in every scene.
//
// Tagging leads and quality follows it, matching the order the app itself is
// explained in: the metadata is the job people come for, and the fake-lossless
// verdict lands harder once they already know what Surco is for.
export default function Walkthrough() {
  const { t, i18n } = useTranslation()
  const guideHref = PAGES.guide[i18n.language === 'en' ? 'en' : 'es']

  return (
    <>
      <Reveal>
        {/* The anchor sits on the heading block, not on the padding that precedes it.
            With `id` on the padded wrapper, "Cómo funciona" scrolled to the top of a
            pt-24 gap and the scroll-mt pushed it further still, landing the visitor on
            roughly a screen of empty background with the title grazing the bottom
            edge, on the one link whose job is to show what the app does. */}
        <div className="pt-24">
          <div id="como" className="scroll-mt-8 text-center">
            <div className="flex justify-center">
              <Kicker>{t('home.walkthrough.kicker')}</Kicker>
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {t('home.walkthrough.title')}
            </h2>
            <p className="mx-auto mt-3 max-w-xl leading-relaxed text-pretty text-muted">
              {t('home.walkthrough.lede')}
            </p>
          </div>
        </div>
      </Reveal>

      <SceneLayout
        step={t('home.drop.step')}
        title={t('home.drop.title')}
        app={
          <AppFrame pill={t('home.drop.pill')} busy progress={66}>
            <TrackRows
              rows={[
                { name: 'Kaleidos - Take Me To The Limit', format: 'FLAC' },
                { name: 'Kalura - Pay For Love', state: 'loading', format: 'FLAC' },
                { name: 'Karen B - Natural Woman', state: 'loading', format: 'FLAC' },
                { name: 'Ken Laszlo - When I Fall In Love', state: 'loading', format: 'FLAC' },
                { name: 'Kim Sanders - Ride', state: 'loading', format: 'FLAC' },
                { name: 'Kriss - Tonight', state: 'loading', format: 'FLAC' },
                { name: 'Lia - Private Fantasy', state: 'loading', format: 'FLAC' },
              ]}
            />
            <p className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-faint">
              {t('home.drop.caption')}
            </p>
          </AppFrame>
        }
      >
        {t('home.drop.lede')}
      </SceneLayout>

      <SceneLayout step={t('home.tag.step')} title={t('home.tag.title')} app={<TagScene />}>
        {t('home.tag.lede')}
      </SceneLayout>

      <SceneLayout
        wide
        step={t('home.quality.step')}
        title={t('home.quality.title')}
        app={
          <AppFrame pill={t('home.quality.pill')}>
            <SpectrumPair />
          </AppFrame>
        }
      >
        {t('home.quality.lede')}
      </SceneLayout>

      <SceneLayout
        wide
        step={t('home.declick.step')}
        title={t('home.declick.title')}
        app={
          <AppFrame pill={t('home.declick.pill')}>
            <DeclickScene />
          </AppFrame>
        }
      >
        {t('home.declick.lede')}
      </SceneLayout>

      <SceneLayout
        step={t('home.trim.step')}
        title={t('home.trim.title')}
        app={
          <AppFrame pill={t('home.trim.pill')}>
            <TrimScene />
          </AppFrame>
        }
      >
        {t('home.trim.lede')}
      </SceneLayout>

      <SceneLayout
        step={t('home.normalize.step')}
        title={t('home.normalize.title')}
        app={
          <AppFrame pill={t('home.normalize.pill')}>
            <NormalizeScene />
          </AppFrame>
        }
      >
        {t('home.normalize.lede')}
      </SceneLayout>

      <SceneLayout
        wide
        step={t('home.batch.step')}
        title={t('home.batch.title')}
        app={<BatchScene />}
      >
        {t('home.batch.lede')}
      </SceneLayout>

      <Reveal>
        <a
          href={guideHref}
          className="inline-flex items-center text-sm font-medium text-fg transition-colors hover:text-blue"
        >
          {t('how.guideCta')}
        </a>
      </Reveal>
    </>
  )
}
