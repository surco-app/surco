import { useTranslation } from 'react-i18next'
import Footer from './Footer'
import Header from './Header'
import Kicker from './Kicker'
import Reveal from './Reveal'
import ScrollProgress from './ScrollProgress'

type Link = { name: string; url: string }

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue underline-offset-4 transition-colors hover:underline"
    >
      {children}
    </a>
  )
}

function LinkList({ links }: { links: Link[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {links.map((l) => (
        <li key={l.url}>
          <ExternalLink href={l.url}>{l.name}</ExternalLink>
        </li>
      ))}
    </ul>
  )
}

export default function Privacy() {
  const { t } = useTranslation()
  const privacyItems = t('privacy.privacyItems', { returnObjects: true }) as string[]
  const policies = t('privacy.policies', { returnObjects: true }) as Link[]
  const webPolicyLinks = t('privacy.webPolicyLinks', { returnObjects: true }) as Link[]

  return (
    <div className="min-h-screen bg-bg text-fg antialiased">
      <ScrollProgress />

      <Header page="privacy" />

      <main id="main" className="relative mx-auto max-w-3xl px-6 sm:px-10">
        <section className="pt-12 pb-10 sm:pt-16">
          <Reveal eager>
            <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-5xl">
              {t('privacy.title')}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{t('privacy.lede')}</p>
          </Reveal>
        </section>

        <section className="py-16 sm:py-20" data-testid="privacy-app">
          <Reveal>
            <Kicker>{t('privacy.privacyHeading')}</Kicker>
            <p className="mt-4 leading-relaxed text-muted">{t('privacy.privacyLede')}</p>
            <ul className="mt-5 space-y-3">
              {privacyItems.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-muted">
                  <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-blue" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm font-semibold">{t('privacy.policiesLabel')}</p>
            <LinkList links={policies} />
          </Reveal>
        </section>

        <section className="py-16 sm:py-20" data-testid="privacy-web">
          <Reveal>
            <Kicker>{t('privacy.webHeading')}</Kicker>
            <p className="mt-4 leading-relaxed text-muted">{t('privacy.webBody')}</p>
            <p className="mt-6 text-sm font-semibold">{t('privacy.webPolicies')}</p>
            <LinkList links={webPolicyLinks} />
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  )
}
