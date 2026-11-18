import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { SCENE_ANCHORS, SECTION_VIEWS } from '../lib/sceneAnchors'
import { SPEED_COUNT_MS, SPEED_FIGURES, speedFrame } from '../lib/speed'
import { useSceneProgress } from '../lib/useSceneProgress'
import Reveal from './Reveal'
import SectionView from './SectionView'
import { AnchorLink } from './scenes/Replay'

export default function Speed() {
  const { t, i18n } = useTranslation()
  const list = useRef<HTMLUListElement>(null)
  const progress = useSceneProgress(list, SPEED_COUNT_MS)
  const finals = speedFrame(1, i18n.language)
  const shown = speedFrame(progress === 0 ? 1 : progress, i18n.language)

  return (
    <section data-testid="speed" className="pt-24">
      <SectionView location={SECTION_VIEWS.speed} />
      <Reveal>
        <div id={SCENE_ANCHORS.speed} className="scroll-mt-8 text-center">
          <div className="group/title mx-auto max-w-2xl text-balance">
            <h2 className="inline text-[min(1.875rem,6.15vw)] font-semibold tracking-tight text-balance sm:text-5xl">
              {t('home.speed.title')}
            </h2>
            <AnchorLink id={SCENE_ANCHORS.speed} />
          </div>
          <p className="mx-auto mt-3 max-w-2xl leading-relaxed text-pretty text-muted">
            {t('home.speed.lede')}
          </p>
        </div>
      </Reveal>
      <ul ref={list} className="mt-16 grid gap-12 text-center sm:grid-cols-3 sm:gap-8">
        {SPEED_FIGURES.map(({ key, unit }, index) => (
          <li key={key} data-testid="speed-figure">
            <p className="font-mono text-[min(4.5rem,17vw)] leading-none font-semibold tracking-tighter tabular-nums">
              <span
                data-testid="speed-value"
                className="inline-block text-right"
                style={{ width: `${finals[index].length}ch` }}
              >
                {shown[index]}
              </span>
              {unit && (
                <small className="ml-[0.15em] text-[0.38em] tracking-normal text-muted">
                  {unit}
                </small>
              )}
            </p>
            <p className="mx-auto mt-4 max-w-60 text-[0.9375rem] text-balance text-muted">
              {t(`home.speed.figures.${key}`)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
