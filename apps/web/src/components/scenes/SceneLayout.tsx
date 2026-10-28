import type { ReactNode } from 'react'
import Reveal from '../Reveal'
import { AnchorLink, Replayable } from './Replay'

// One step of the walkthrough: a slab of app UI on one side, a short caption on the
// other. Alternating `flip` keeps the eye moving down the page instead of running
// along a single column, and on narrow screens both sides stack with the caption
// first so the text still leads.
export default function SceneLayout({
  id,
  step,
  title,
  children,
  app,
  flip = false,
  wide = false,
}: {
  id: string
  step: string
  title: ReactNode
  children: ReactNode
  app: ReactNode
  flip?: boolean
  wide?: boolean
}) {
  if (wide) {
    return (
      <section id={id} className="scroll-mt-12 py-16 sm:py-24">
        <Reveal>
          <p className="font-mono text-xs tracking-wider text-blue uppercase">{step}</p>
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
  // The caption column is wider than the 17rem it used to be: at that width every
  // step's heading broke into two short lines ("Suéltalas y ya / están dentro.") and
  // the paragraph under it ran seven lines deep. A hairline replaces the 168px of
  // empty background that used to separate one step from the next.
  // grid-cols-[minmax(0,1fr)] on the single-column layout: the implicit track is `auto`,
  // which sizes to the widest content, so the queue's truncated track names stretched the
  // step past the viewport and clipped its heading and copy off the right edge on a phone.
  // `minmax(0, …)` lets the column shrink below its content.
  return (
    <section
      id={id}
      className="grid scroll-mt-12 grid-cols-[minmax(0,1fr)] items-center gap-8 border-b border-line/50 py-10 last:border-b-0 sm:py-12 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-14"
    >
      <Reveal from={flip ? 'right' : 'left'} className={flip ? 'lg:order-2' : ''}>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{step}</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {title}
          <AnchorLink id={id} />
        </h2>
        <div className="mt-3 leading-relaxed text-pretty text-muted">{children}</div>
      </Reveal>
      <Reveal from={flip ? 'left' : 'right'} delay={120} className={flip ? 'lg:order-1' : ''}>
        <Replayable>{app}</Replayable>
      </Reveal>
    </section>
  )
}
