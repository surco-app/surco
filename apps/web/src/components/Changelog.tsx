import { useTranslation } from 'react-i18next'
import Reveal from './Reveal'
import DownloadButton from './DownloadButton'
import Header from './Header'
import Footer from './Footer'
import { useAutoLanguage } from '../lib/useAutoLanguage'

type Release = {
  version: string
  date: string
  title: string
  items: string[]
}

export default function Changelog() {
  const { t } = useTranslation()
  useAutoLanguage()

  const releases = t('changelog.releases', { returnObjects: true }) as Release[]

  return (
    <div className="min-h-screen bg-bg text-fg antialiased">
      <div className="grain pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-soft-light" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{
          background:
            'radial-gradient(55% 50% at 72% 4%, rgba(122,162,247,0.18) 0%, rgba(26,27,38,0) 70%)',
        }}
      />

      <Header page="changelog" />

      <main id="main" className="relative mx-auto max-w-3xl px-6">
        <section className="pt-12 pb-4 sm:pt-16">
          <Reveal>
            <p className="font-mono text-xs tracking-wider text-blue uppercase">
              {t('changelog.kicker')}
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
              {t('changelog.title')}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{t('changelog.lede')}</p>
          </Reveal>
        </section>

        {releases.map((r) => (
          <section key={r.version} className="border-t border-line/60 py-12 first-of-type:border-t-0">
            <Reveal>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="rounded-full border border-line bg-surface2/40 px-3 py-1 font-mono text-sm text-blue">
                  v{r.version}
                </span>
                <span className="font-mono text-xs text-faint">{r.date}</span>
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">{r.title}</h2>
              <ul className="mt-5 space-y-2.5">
                {r.items.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-relaxed text-muted">
                    <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-blue" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </section>
        ))}

        <section className="border-t border-line/60 py-16 text-center">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('changelog.outroTitle')}
            </h2>
            <p className="mx-auto mt-4 max-w-md leading-relaxed text-muted">
              {t('changelog.outroLede')}
            </p>
            <div className="mt-2 flex flex-col items-center text-center">
              <DownloadButton showAnalysis={false} />
            </div>
          </Reveal>
        </section>
      </main>

      <Footer page="changelog" />
    </div>
  )
}
