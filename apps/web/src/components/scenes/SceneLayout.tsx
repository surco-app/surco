import type { ReactNode } from 'react'
import Reveal from '../Reveal'

// One step of the walkthrough: a slab of app UI on one side, a short caption on the
// other. Alternating `flip` keeps the eye moving down the page instead of running
// along a single column, and on narrow screens both sides stack with the caption
// first so the text still leads.
export default function SceneLayout({
  step,
  title,
  children,
  app,
  flip = false,
  wide = false,
}: {
  step: string
  title: ReactNode
  children: ReactNode
  app: ReactNode
  flip?: boolean
  wide?: boolean
}) {
  if (wide) {
    return (
      <section className="border-b border-line/50 py-10 last:border-b-0 sm:py-12">
        <Reveal>
          <p className="font-mono text-xs tracking-wider text-blue uppercase">{step}</p>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {title}
          </h2>
          <div className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{children}</div>
        </Reveal>
        <Reveal delay={120} className="mt-7">
          {app}
        </Reveal>
      </section>
    )
  }
  // The caption column is wider than the 17rem it used to be: at that width every
  // step's heading broke into two short lines ("Suéltalas y ya / están dentro.") and
  // the paragraph under it ran seven lines deep. A hairline replaces the 168px of
  // empty background that used to separate one step from the next.
  return (
    <section className="grid items-center gap-8 border-b border-line/50 py-10 last:border-b-0 sm:py-12 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-14">
      <Reveal from={flip ? 'right' : 'left'} className={flip ? 'lg:order-2' : ''}>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{step}</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {title}
        </h2>
        <div className="mt-3 leading-relaxed text-pretty text-muted">{children}</div>
      </Reveal>
      <Reveal from={flip ? 'left' : 'right'} delay={120} className={flip ? 'lg:order-1' : ''}>
        {app}
      </Reveal>
    </section>
  )
}
