import { useTranslation } from 'react-i18next'
import { PAGES } from '../lib/nav'
import Kicker from './Kicker'
import Reveal from './Reveal'
import AppFrame from './scenes/AppFrame'
import BatchScene from './scenes/BatchScene'
import DeclickScene from './scenes/DeclickScene'
import DropScene from './scenes/DropScene'
import NormalizeScene from './scenes/NormalizeScene'
import SceneLayout from './scenes/SceneLayout'
import SpectrumPair from './scenes/SpectrumPair'
import TagScene from './scenes/TagScene'
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

      <SceneLayout step={t('home.drop.step')} title={t('home.drop.title')} app={<DropScene />}>
        {t('home.drop.lede')}
      </SceneLayout>

      <SceneLayout flip step={t('home.tag.step')} title={t('home.tag.title')} app={<TagScene />}>
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

      {/* Declick, trim and normalize under one heading. Each was a full-height section of
          its own, which spent three screens of scroll on the part of the flow the page
          itself calls "and while it's at it": the tagging and the fake-lossless verdict are
          what a visitor comes for, and they were being crowded out by their own footnotes. */}
      <section className="border-b border-line/50 py-10 sm:py-12">
        <Reveal>
          <p className="font-mono text-xs tracking-wider text-blue uppercase">
            {t('home.audioGroup.step')}
          </p>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {t('home.audioGroup.title')}
          </h2>
          <div className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">
            {t('home.audioGroup.lede')}
          </div>
        </Reveal>
        <Reveal delay={120} className="mt-7">
          <div className="grid gap-5 lg:grid-cols-3">
            <div>
              <AppFrame pill={t('home.declick.pill')}>
                <DeclickScene />
              </AppFrame>
              <p className="mt-3 text-sm leading-relaxed text-pretty text-muted">
                {t('home.declick.short')}
              </p>
            </div>
            <div>
              <AppFrame pill={t('home.trim.pill')}>
                <TrimScene />
              </AppFrame>
              <p className="mt-3 text-sm leading-relaxed text-pretty text-muted">
                {t('home.trim.short')}
              </p>
            </div>
            <div>
              <AppFrame pill={t('home.normalize.pill')}>
                <NormalizeScene />
              </AppFrame>
              <p className="mt-3 text-sm leading-relaxed text-pretty text-muted">
                {t('home.normalize.short')}
              </p>
            </div>
          </div>
        </Reveal>
      </section>

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
