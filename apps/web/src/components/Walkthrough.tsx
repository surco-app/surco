import { useTranslation } from 'react-i18next'
import type { Language } from '../i18n'
import { PAGES } from '../lib/nav'
import { SCENE_ANCHORS } from '../lib/sceneAnchors'
import Reveal from './Reveal'
import BatchScene from './scenes/BatchScene'
import DeclickScene from './scenes/DeclickScene'
import DropScene from './scenes/DropScene'
import NormalizeScene from './scenes/NormalizeScene'
import QualityScene from './scenes/QualityScene'
import { AnchorLink, Replayable } from './scenes/Replay'
import SceneLayout from './scenes/SceneLayout'
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
  const guideHref = PAGES.guide[i18n.language as Language]

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
            <h2 className="text-[min(1.875rem,6.15vw)] font-semibold tracking-tight text-balance sm:text-5xl">
              {t('home.walkthrough.title')}
            </h2>
            <p className="mx-auto mt-3 max-w-xl leading-relaxed text-pretty text-muted">
              {t('home.walkthrough.lede')}
            </p>
          </div>
        </div>
      </Reveal>

      <SceneLayout id={SCENE_ANCHORS.drop} title={t('home.drop.title')} app={<DropScene />}>
        {t('home.drop.lede')}
      </SceneLayout>

      <SceneLayout id={SCENE_ANCHORS.tag} title={t('home.tag.title')} app={<TagScene />}>
        {t('home.tag.lede')}
      </SceneLayout>

      <SceneLayout
        id={SCENE_ANCHORS.quality}
        title={t('home.quality.title')}
        app={<QualityScene />}
        field
      >
        {t('home.quality.lede')}
      </SceneLayout>

      {/* Declick, trim and normalize under one heading. Each was a full-height section of
          its own, which spent three screens of scroll on the part of the flow the page
          itself calls "and while it's at it": the tagging and the fake-lossless verdict are
          what a visitor comes for, and they were being crowded out by their own footnotes. */}
      <section id={SCENE_ANCHORS.audio} className="scroll-mt-12 py-16 sm:py-24">
        <Reveal>
          <div className="lg:grid lg:grid-cols-2 lg:items-end lg:gap-16">
            <h2 className="group/title text-[min(1.875rem,6.15vw)] font-semibold tracking-tight text-balance sm:text-4xl">
              {t('home.audioGroup.title')}
              <AnchorLink id={SCENE_ANCHORS.audio} />
            </h2>
            <div className="mt-3 leading-relaxed text-pretty text-muted lg:mt-0">
              {t('home.audioGroup.lede')}
            </div>
          </div>
        </Reveal>
        <Reveal delay={120} className="mt-10">
          <div className="grid gap-5 lg:grid-cols-3">
            <div id={SCENE_ANCHORS.declick} className="scroll-mt-24">
              <Replayable>
                <div className="lg:h-[350px]">
                  <DeclickScene />
                </div>
              </Replayable>
              <p className="group/title mt-3 text-sm leading-relaxed text-pretty text-muted">
                {t('home.declick.short')}
                <AnchorLink id={SCENE_ANCHORS.declick} />
              </p>
            </div>
            <div id={SCENE_ANCHORS.trim} className="scroll-mt-24">
              <Replayable>
                <div className="lg:h-[350px]">
                  <TrimScene />
                </div>
              </Replayable>
              <p className="group/title mt-3 text-sm leading-relaxed text-pretty text-muted">
                {t('home.trim.short')}
                <AnchorLink id={SCENE_ANCHORS.trim} />
              </p>
            </div>
            <div id={SCENE_ANCHORS.normalize} className="scroll-mt-24">
              <Replayable>
                <div className="lg:h-[350px]">
                  <NormalizeScene />
                </div>
              </Replayable>
              <p className="group/title mt-3 text-sm leading-relaxed text-pretty text-muted">
                {t('home.normalize.short')}
                <AnchorLink id={SCENE_ANCHORS.normalize} />
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      <SceneLayout id={SCENE_ANCHORS.batch} title={t('home.batch.title')} app={<BatchScene />}>
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
