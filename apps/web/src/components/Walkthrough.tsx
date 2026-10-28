import { useTranslation } from 'react-i18next'
import type { Language } from '../i18n'
import { PAGES } from '../lib/nav'
import { SCENE_ANCHORS } from '../lib/sceneAnchors'
import Kicker from './Kicker'
import Reveal from './Reveal'
import BatchScene from './scenes/BatchScene'
import CuesScene from './scenes/CuesScene'
import DeclickScene from './scenes/DeclickScene'
import DropScene from './scenes/DropScene'
import NormalizeScene from './scenes/NormalizeScene'
import QualityScene from './scenes/QualityScene'
import ReplaceScene from './scenes/ReplaceScene'
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
            <Kicker>{t('home.walkthrough.kicker')}</Kicker>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
              {t('home.walkthrough.title')}
            </h2>
            <p className="mx-auto mt-3 max-w-xl leading-relaxed text-pretty text-muted">
              {t('home.walkthrough.lede')}
            </p>
          </div>
        </div>
      </Reveal>

      <SceneLayout
        id={SCENE_ANCHORS.drop}
        step={t('home.drop.step')}
        title={t('home.drop.title')}
        app={<DropScene />}
      >
        {t('home.drop.lede')}
      </SceneLayout>

      <SceneLayout
        id={SCENE_ANCHORS.tag}
        step={t('home.tag.step')}
        title={t('home.tag.title')}
        app={<TagScene />}
      >
        {t('home.tag.lede')}
      </SceneLayout>

      <SceneLayout
        id={SCENE_ANCHORS.quality}
        step={t('home.quality.step')}
        title={t('home.quality.title')}
        app={<QualityScene />}
      >
        {t('home.quality.lede')}
      </SceneLayout>

      {/* Declick, trim and normalize under one heading. Each was a full-height section of
          its own, which spent three screens of scroll on the part of the flow the page
          itself calls "and while it's at it": the tagging and the fake-lossless verdict are
          what a visitor comes for, and they were being crowded out by their own footnotes. */}
      <section id={SCENE_ANCHORS.audio} className="scroll-mt-12 py-16 sm:py-24">
        <Reveal>
          <Kicker>{t('home.audioGroup.step')}</Kicker>
          <h2 className="group/title mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t('home.audioGroup.title')}
            <AnchorLink id={SCENE_ANCHORS.audio} />
          </h2>
          <div className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">
            {t('home.audioGroup.lede')}
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

      <SceneLayout
        id={SCENE_ANCHORS.batch}
        step={t('home.batch.step')}
        title={t('home.batch.title')}
        app={<BatchScene />}
      >
        {t('home.batch.lede')}
      </SceneLayout>

      {/* After the flow, because it comes after it in the work: the track is already in
          the library when a better file turns up. */}
      <SceneLayout
        id={SCENE_ANCHORS.replace}
        step={t('home.replace.step')}
        title={t('home.replace.title')}
        app={<ReplaceScene />}
      >
        {t('home.replace.lede')}
      </SceneLayout>

      <SceneLayout
        id={SCENE_ANCHORS.cues}
        step={t('home.cues.step')}
        title={t('home.cues.title')}
        app={<CuesScene />}
      >
        {t('home.cues.lede')}
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
