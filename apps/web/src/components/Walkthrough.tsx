import { useTranslation } from 'react-i18next'
import type { Language } from '../i18n'
import { PAGES } from '../lib/nav'
import { SCENE_ANCHORS, SECTION_VIEWS } from '../lib/sceneAnchors'
import Reveal from './Reveal'
import BatchScene from './scenes/BatchScene'
import QualityScene from './scenes/QualityScene'
import SceneLayout from './scenes/SceneLayout'
import TagScene from './scenes/TagScene'

export default function Walkthrough() {
  const { t, i18n } = useTranslation()
  const guideHref = PAGES.guide[i18n.language as Language]

  return (
    <>
      <SceneLayout
        id={SCENE_ANCHORS.quality}
        view={SECTION_VIEWS.quality}
        title={t('home.quality.title')}
        app={<QualityScene />}
        field
      >
        {t('home.quality.lede')}
      </SceneLayout>

      <SceneLayout
        id={SCENE_ANCHORS.tag}
        view={SECTION_VIEWS.tag}
        title={t('home.tag.title')}
        app={<TagScene />}
      >
        {t('home.tag.lede')}
      </SceneLayout>

      <SceneLayout
        id={SCENE_ANCHORS.batch}
        view={SECTION_VIEWS.batch}
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
