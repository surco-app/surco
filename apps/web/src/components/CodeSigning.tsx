import { useTranslation } from 'react-i18next'
import Footer from './Footer'
import Header from './Header'
import Kicker from './Kicker'
import Reveal from './Reveal'
import ScrollProgress from './ScrollProgress'

type Role = { role: string; desc: string }
type Link = { name: string; url: string }

const MEMBER_URL = 'https://github.com/vigosan'
const SOURCE_URL = 'https://github.com/surco-app/surco'

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

export default function CodeSigning() {
  const { t } = useTranslation()
  const signingBody = t('codeSigning.signingBody', { returnObjects: true }) as string[]
  const roles = t('codeSigning.roles', { returnObjects: true }) as Role[]
  const privacyItems = t('codeSigning.privacyItems', { returnObjects: true }) as string[]
  const policies = t('codeSigning.policies', { returnObjects: true }) as Link[]
  const webPolicyLinks = t('codeSigning.webPolicyLinks', { returnObjects: true }) as Link[]

  return (
    <div className="min-h-screen bg-bg text-fg antialiased">
      <ScrollProgress />
      <div className="grain pointer-events-none fixed inset-0 z-[1] opacity-[0.03] mix-blend-soft-light" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{
          background:
            'radial-gradient(55% 50% at 72% 4%, rgba(122,162,247,0.18) 0%, rgba(26,27,38,0) 70%)',
        }}
      />

      <Header page="codeSigning" />

      <main id="main" className="relative mx-auto max-w-3xl px-6">
        <section className="pt-12 pb-10 sm:pt-16">
          <Reveal eager>
            <p className="font-mono text-xs tracking-wider text-blue uppercase">
              {t('codeSigning.kicker')}
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-5xl">
              {t('codeSigning.title')}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              {t('codeSigning.lede')}
            </p>
          </Reveal>
        </section>

        <section className="border-t border-line/60 py-12" data-testid="code-signing-signing">
          <Reveal>
            <Kicker>{t('codeSigning.signingHeading')}</Kicker>
            <p className="mt-4 text-lg font-semibold tracking-tight">
              {t('codeSigning.attribution')}
            </p>
            <div className="mt-4 space-y-3 leading-relaxed text-muted">
              {signingBody.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <p className="mt-5 rounded-xl border border-line bg-surface2/40 px-4 py-3 text-sm leading-relaxed text-muted">
              {t('codeSigning.pending')}
            </p>
          </Reveal>
        </section>

        <section className="border-t border-line/60 py-12" data-testid="code-signing-team">
          <Reveal>
            <Kicker>{t('codeSigning.teamHeading')}</Kicker>
            <p className="mt-4 leading-relaxed text-muted">{t('codeSigning.teamLede')}</p>
            <dl className="mt-6 divide-y divide-line/60 border-y border-line/60">
              {roles.map((r) => (
                <div key={r.role} className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-6">
                  <dt className="font-semibold">{r.role}</dt>
                  <dd className="text-muted">
                    <ExternalLink href={MEMBER_URL}>{t('codeSigning.member')}</ExternalLink>
                    <span className="mt-1 block text-sm">{r.desc}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-sm text-muted">
              {t('codeSigning.sourceLabel')}{' '}
              <ExternalLink href={SOURCE_URL}>github.com/surco-app/surco</ExternalLink>
            </p>
          </Reveal>
        </section>

        <section className="border-t border-line/60 py-12" data-testid="code-signing-privacy">
          <Reveal>
            <Kicker>{t('codeSigning.privacyHeading')}</Kicker>
            <p className="mt-4 leading-relaxed text-muted">{t('codeSigning.privacyLede')}</p>
            <ul className="mt-5 space-y-3">
              {privacyItems.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-muted">
                  <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-blue" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm font-semibold">{t('codeSigning.policiesLabel')}</p>
            <LinkList links={policies} />
          </Reveal>
        </section>

        <section className="border-t border-line/60 py-12" data-testid="code-signing-web">
          <Reveal>
            <Kicker>{t('codeSigning.webHeading')}</Kicker>
            <p className="mt-4 leading-relaxed text-muted">{t('codeSigning.webBody')}</p>
            <p className="mt-6 text-sm font-semibold">{t('codeSigning.webPolicies')}</p>
            <LinkList links={webPolicyLinks} />
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  )
}
