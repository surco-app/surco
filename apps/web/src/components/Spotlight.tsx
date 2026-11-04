import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { SectionLocation } from '../lib/analytics'
import Reveal from './Reveal'
import SectionView from './SectionView'
import { AnchorLink, Replayable } from './scenes/Replay'

export default function Spotlight({
  id,
  view,
  copy,
  points,
  scene,
  children,
}: {
  id: string
  view: SectionLocation
  copy: 'cues' | 'replace' | 'sync'
  points: readonly string[]
  scene: ReactNode
  children?: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <section data-testid={`spotlight-${copy}`} className="pt-24">
      <SectionView location={view} />
      <Reveal>
        <div id={id} className="scroll-mt-8 text-center">
          <h2 className="group/title mx-auto max-w-3xl text-[min(1.875rem,6.15vw)] font-semibold tracking-tight text-balance sm:text-5xl">
            {t(`home.${copy}.title`)}
            <AnchorLink id={id} />
          </h2>
          <p className="mx-auto mt-3 max-w-2xl leading-relaxed text-pretty text-muted">
            {t(`home.${copy}.lede`)}
          </p>
        </div>
      </Reveal>
      <Reveal delay={120} className="mt-8">
        <Replayable>{scene}</Replayable>
      </Reveal>
      <Reveal delay={160}>
        <ul className="mt-8 grid gap-4 sm:grid-cols-3">
          {points.map((key) => (
            <li key={key} className="rounded-xl bg-surface p-5">
              <p className="text-sm font-semibold text-fg">
                {t(`home.${copy}.points.${key}.title`)}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-pretty text-muted">
                {t(`home.${copy}.points.${key}.text`)}
              </p>
            </li>
          ))}
        </ul>
      </Reveal>
      {children && (
        <Reveal delay={200} className="mt-6">
          <Replayable>{children}</Replayable>
        </Reveal>
      )}
    </section>
  )
}
