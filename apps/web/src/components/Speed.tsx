import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SCENE_ANCHORS, SECTION_VIEWS } from '../lib/sceneAnchors'
import { SPEED_COUNT_MS, SPEED_FIGURES, speedFrame } from '../lib/speed'
import { useSceneProgress } from '../lib/useSceneProgress'
import Reveal from './Reveal'
import SectionView from './SectionView'
import { AnchorLink } from './scenes/Replay'

function SpeedFigure({ index, unit, caption }: { index: number; unit: string; caption: string }) {
  const { i18n } = useTranslation()
  const item = useRef<HTMLLIElement>(null)
  const [armed, setArmed] = useState(false)
  const progress = useSceneProgress(item, SPEED_COUNT_MS)
  const final = speedFrame(1, i18n.language)[index]
  const shown = armed ? speedFrame(progress, i18n.language)[index] : final

  useEffect(() => {
    const el = item.current
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (el.getBoundingClientRect().top > window.innerHeight) setArmed(true)
  }, [])

  return (
    <li ref={item} data-testid="speed-figure">
      <p className="font-mono text-[min(4.5rem,17vw)] leading-none font-semibold tracking-tighter tabular-nums">
        <span aria-hidden="true">
          <span className="inline-grid">
            <span data-testid="speed-size" className="invisible col-start-1 row-start-1">
              {final}
            </span>
            <span data-testid="speed-value" className="col-start-1 row-start-1 text-right">
              {shown}
            </span>
          </span>
          {unit && (
            <small className="ml-[0.15em] text-[0.38em] tracking-normal text-muted">{unit}</small>
          )}
        </span>
        <span data-testid="speed-spoken" className="sr-only">
          {unit ? `${final} ${unit}` : final}
        </span>
      </p>
      <p className="mx-auto mt-4 max-w-60 text-[0.9375rem] text-balance text-muted">{caption}</p>
    </li>
  )
}

export default function Speed() {
  const { t } = useTranslation()

  return (
    <section data-testid="speed" className="pt-24">
      <SectionView location={SECTION_VIEWS.speed} />
      <Reveal>
        <div id={SCENE_ANCHORS.speed} className="scroll-mt-8 text-center">
          <div className="group/title mx-auto max-w-2xl text-balance">
            <h2 className="inline text-2xl font-semibold tracking-tight text-balance">
              {t('home.speed.title')}
            </h2>
            <AnchorLink id={SCENE_ANCHORS.speed} />
          </div>
          <p className="mx-auto mt-3 max-w-2xl leading-relaxed text-pretty text-muted">
            {t('home.speed.lede')}
          </p>
        </div>
      </Reveal>
      <ul className="mt-16 grid gap-12 text-center sm:grid-cols-3 sm:gap-8">
        {SPEED_FIGURES.map(({ key, unit }, index) => (
          <SpeedFigure
            key={key}
            index={index}
            unit={unit}
            caption={t(`home.speed.figures.${key}`)}
          />
        ))}
      </ul>
    </section>
  )
}
