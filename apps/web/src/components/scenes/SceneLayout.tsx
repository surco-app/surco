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
      <section className="py-14 sm:py-20">
        <Reveal>
          <p className="font-mono text-xs tracking-wider text-blue uppercase">{step}</p>
          <h2 className="mt-4 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {title}
          </h2>
          <div className="mt-4 max-w-2xl leading-relaxed text-pretty text-muted">{children}</div>
        </Reveal>
        <Reveal delay={120} className="mt-8">
          {app}
        </Reveal>
      </section>
    )
  }
  return (
    <section className="grid items-center gap-8 py-14 sm:py-20 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-14">
      <Reveal from={flip ? 'right' : 'left'} className={flip ? 'lg:order-2' : ''}>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{step}</p>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {title}
        </h2>
        <div className="mt-4 leading-relaxed text-pretty text-muted">{children}</div>
      </Reveal>
      <Reveal from={flip ? 'left' : 'right'} delay={120} className={flip ? 'lg:order-1' : ''}>
        {app}
      </Reveal>
    </section>
  )
}
