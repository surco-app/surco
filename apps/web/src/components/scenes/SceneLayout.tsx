import type { ReactNode } from 'react'
import Reveal from '../Reveal'
import { AnchorLink, Replayable } from './Replay'

// One step of the walkthrough: its heading and caption over a full-width slab of app UI.
// Every step takes the page's width, so the editor's values have room to read.
export default function SceneLayout({
  id,
  title,
  children,
  app,
  field = false,
}: {
  id: string
  title: ReactNode
  children: ReactNode
  app: ReactNode
  field?: boolean
}) {
  return (
    <section
      id={id}
      className={
        field
          ? 'relative isolate my-16 scroll-mt-12 py-20 text-bg before:absolute before:inset-y-0 before:left-1/2 before:-z-10 before:w-screen before:-translate-x-1/2 before:bg-blue sm:my-24 sm:py-28'
          : 'scroll-mt-12 py-16 sm:py-20'
      }
    >
      <Reveal>
        <div className="lg:grid lg:grid-cols-2 lg:items-end lg:gap-16">
          <h2
            className={`group/title font-semibold tracking-tight text-balance ${
              field
                ? 'text-[min(2.25rem,7.6vw)] sm:text-6xl'
                : 'text-[min(1.875rem,6.15vw)] sm:text-4xl'
            }`}
          >
            {title}
            <AnchorLink id={id} />
          </h2>
          <div
            className={`mt-3 leading-relaxed text-pretty lg:mt-0 ${field ? 'text-bg/85' : 'text-muted'}`}
          >
            {children}
          </div>
        </div>
      </Reveal>
      <Reveal delay={120} className="mt-10">
        <Replayable>{app}</Replayable>
      </Reveal>
    </section>
  )
}
