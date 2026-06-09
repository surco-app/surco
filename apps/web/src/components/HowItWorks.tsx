import { useTranslation } from 'react-i18next'
import Reveal from './Reveal'

export default function HowItWorks() {
  const { t, i18n } = useTranslation()
  const steps = t('how.steps', { returnObjects: true }) as { title: string; body: string }[]
  const guideHref = i18n.language === 'en' ? '/en/guide' : '/guia'

  return (
    <section id="como" className="scroll-mt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('how.kicker')}</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{t('how.title')}</h2>
      </Reveal>

      <div className="relative mt-12 grid gap-8 md:grid-cols-3">
        <div className="pointer-events-none absolute top-6 right-8 left-8 hidden h-px bg-gradient-to-r from-transparent via-line to-transparent md:block" />
        {steps.map((s, i) => (
          <Reveal key={s.title} delay={i * 120}>
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-blue/40 bg-bg font-mono text-lg text-blue">
                {i + 1}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-fg">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <a
          href={guideHref}
          className="mt-10 inline-flex items-center text-sm font-medium text-fg transition-colors hover:text-blue"
        >
          {t('how.guideCta')}
        </a>
      </Reveal>
    </section>
  )
}
