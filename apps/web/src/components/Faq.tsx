import { useTranslation } from 'react-i18next'
import Reveal from './Reveal'

// Native <details> so the answers are open to crawlers and keyboard users with no
// JS; the +/× marker is the only thing the `group-open` state drives.
export default function Faq() {
  const { t } = useTranslation()
  const items = t('faq.items', { returnObjects: true }) as { q: string; a: string }[]

  return (
    <section id="faq" className="scroll-mt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('faq.kicker')}</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{t('faq.title')}</h2>
      </Reveal>
      <div className="mt-10 max-w-2xl border-t border-line/60">
        {items.map((item, i) => (
          <Reveal key={item.q} delay={(i % 2) * 80}>
            <details className="group border-b border-line/60 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-fg transition-colors hover:text-blue [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  className="font-mono text-lg leading-none text-blue transition-transform duration-200 group-open:rotate-45"
                  aria-hidden="true"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-pretty text-muted">{item.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
