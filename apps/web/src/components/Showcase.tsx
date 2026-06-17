import { useTranslation } from 'react-i18next'
import Reveal from './Reveal'

// A real, full-window screenshot of the app — one per language, since the whole
// UI is localized. The image already carries the macOS window chrome, so a rounded
// border + shadow is all the framing it needs. Sized 2000px wide (≈2× the column)
// for retina; width/height keep the box reserved so there's no layout shift.
export default function Showcase() {
  const { t, i18n } = useTranslation()
  const src = `/app-${i18n.language === 'en' ? 'en' : 'es'}.webp`

  return (
    <section id="captura" className="scroll-mt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('showcase.kicker')}</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t('showcase.title')}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{t('showcase.lede')}</p>
      </Reveal>
      <Reveal delay={120}>
        <figure className="mt-10 overflow-hidden rounded-2xl border border-line bg-surface2/40 shadow-2xl shadow-black/40">
          <img
            src={src}
            alt={t('showcase.alt')}
            width={2000}
            height={1242}
            loading="lazy"
            className="block w-full"
          />
        </figure>
      </Reveal>
    </section>
  )
}
