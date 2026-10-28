import type { ReactNode } from 'react'
import Reveal from '../Reveal'
import { AnchorLink, Replayable } from './Replay'

export const STEP_LABEL = 'text-[0.9375rem] font-medium text-blue'

// One step of the walkthrough: its label, heading and caption over a full-width slab of
// app UI. Every step takes the page's width, so the editor's values have room to read.
export default function SceneLayout({
  id,
  step,
  title,
  children,
  app,
}: {
  id: string
  step: string
  title: ReactNode
  children: ReactNode
  app: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-12 py-16 sm:py-24">
      <Reveal>
        <p className={STEP_LABEL}>{step}</p>
        <h2 className="group/title mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
          <AnchorLink id={id} />
        </h2>
        <div className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{children}</div>
      </Reveal>
      <Reveal delay={120} className="mt-10">
        <Replayable>{app}</Replayable>
      </Reveal>
    </section>
  )
}
