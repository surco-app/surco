import { Analytics } from '@vercel/analytics/react'
import type { ReactNode } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { Outlet } from 'react-router-dom'
import type { RouteRecord } from 'vite-react-ssg'
import { Head } from 'vite-react-ssg'
import App from './App'
import Changelog from './components/Changelog'
import ConvertPageView from './components/ConvertPage'
import DonateCancel from './components/DonateCancel'
import DonateCompleted from './components/DonateCompleted'
import Features from './components/Features'
import GoogleAnalytics from './components/GoogleAnalytics'
import Guide from './components/Guide'
import Privacy from './components/Privacy'
import Stats from './components/Stats'
import UseCasePage, { type UseCase } from './components/UseCase'
import UseCases from './components/UseCases'
import { LANGUAGES, type Language, loadI18n } from './i18n'
import { CONVERT_PAGES, type ConvertPage } from './lib/convertPages'
import { HOME, PAGES } from './lib/nav'
import { SITE } from './lib/sitemap'
import { type RecipePage, recipePages } from './lib/useCases'

const PATHS = HOME
const FEATURE_PATHS = PAGES.features
const GUIDE_PATHS = PAGES.guide
const USE_CASES_PATHS = PAGES.useCases
const CHANGELOG_PATHS = PAGES.changelog
const PRIVACY_PATHS = PAGES.privacy
const STATS_PATHS = PAGES.stats

function localized(lng: Language, page: ReactNode, releases = false) {
  return {
    lazy: async () => ({
      element: <I18nextProvider i18n={await loadI18n(lng, { releases })}>{page}</I18nextProvider>,
    }),
    entry: 'src/routes.tsx',
  }
}

// Every page names its counterpart in each language, and Spanish as the default for
// languages the site does not have.
function alternateLinks(paths: Record<Language, string>) {
  return [
    ...LANGUAGES.map((lng) => (
      <link key={lng} rel="alternate" hrefLang={lng} href={`${SITE}${paths[lng]}`} />
    )),
    <link key="x-default" rel="alternate" hrefLang="x-default" href={`${SITE}${paths.es}`} />,
  ]
}

function DocumentHead({ lng }: { lng: Language }) {
  const { t } = useTranslation()
  const url = SITE + PATHS[lng]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Surco',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'macOS, Windows, Linux',
    url,
    image: `${SITE}/og.png`,
    screenshot: `${SITE}/hero-app-${lng}.webp`,
    inLanguage: t('meta.inLanguage'),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: t('meta.jsonLdDescription'),
  }
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('meta.title')}</title>
      <meta name="description" content={t('meta.description')} />
      <link rel="canonical" href={url} />
      {alternateLinks(PATHS)}
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('meta.ogTitle')} />
      <meta property="og:description" content={t('meta.ogDescription')} />
      <meta name="twitter:title" content={t('meta.ogTitle')} />
      <meta name="twitter:description" content={t('meta.ogDescription')} />
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
    </Head>
  )
}

function LocalizedApp({ lng }: { lng: Language }) {
  return (
    <>
      <DocumentHead lng={lng} />
      <App />
    </>
  )
}

function FeaturesHead({ lng }: { lng: Language }) {
  const { t } = useTranslation()
  const url = SITE + FEATURE_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('features.metaTitle')}</title>
      <meta name="description" content={t('features.metaDescription')} />
      <link rel="canonical" href={url} />
      {alternateLinks(FEATURE_PATHS)}
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('features.metaTitle')} />
      <meta property="og:description" content={t('features.metaDescription')} />
      <meta name="twitter:title" content={t('features.metaTitle')} />
      <meta name="twitter:description" content={t('features.metaDescription')} />
    </Head>
  )
}

function LocalizedFeatures({ lng }: { lng: Language }) {
  return (
    <>
      <FeaturesHead lng={lng} />
      <Features />
    </>
  )
}

function GuideHead({ lng }: { lng: Language }) {
  const { t } = useTranslation()
  const url = SITE + GUIDE_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('guide.metaTitle')}</title>
      <meta name="description" content={t('guide.metaDescription')} />
      <link rel="canonical" href={url} />
      {alternateLinks(GUIDE_PATHS)}
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('guide.metaTitle')} />
      <meta property="og:description" content={t('guide.metaDescription')} />
      <meta name="twitter:title" content={t('guide.metaTitle')} />
      <meta name="twitter:description" content={t('guide.metaDescription')} />
    </Head>
  )
}

function LocalizedGuide({ lng }: { lng: Language }) {
  return (
    <>
      <GuideHead lng={lng} />
      <Guide />
    </>
  )
}

function UseCasesHead({ lng }: { lng: Language }) {
  const { t } = useTranslation()
  const url = SITE + USE_CASES_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('useCases.metaTitle')}</title>
      <meta name="description" content={t('useCases.metaDescription')} />
      <link rel="canonical" href={url} />
      {alternateLinks(USE_CASES_PATHS)}
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('useCases.metaTitle')} />
      <meta property="og:description" content={t('useCases.metaDescription')} />
      <meta name="twitter:title" content={t('useCases.metaTitle')} />
      <meta name="twitter:description" content={t('useCases.metaDescription')} />
    </Head>
  )
}

function LocalizedUseCases({ lng }: { lng: Language }) {
  return (
    <>
      <UseCasesHead lng={lng} />
      <UseCases />
    </>
  )
}

function RecipeHead({ page }: { page: RecipePage }) {
  const { t } = useTranslation()
  const cases = t('useCases.cases', { returnObjects: true }) as UseCase[]
  const c = cases.find((o) => o.id === page.id) as UseCase
  const url = SITE + page.path
  const title = t('useCases.recipeMetaTitle', { title: c.title })
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{title}</title>
      <meta name="description" content={c.body[0]} />
      <link rel="canonical" href={url} />
      {alternateLinks(page.alternates)}
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={c.body[0]} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={c.body[0]} />
    </Head>
  )
}

function LocalizedRecipe({ page }: { page: RecipePage }) {
  return (
    <>
      <RecipeHead page={page} />
      <UseCasePage id={page.id} />
    </>
  )
}

function ChangelogHead({ lng }: { lng: Language }) {
  const { t } = useTranslation()
  const url = SITE + CHANGELOG_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('changelog.metaTitle')}</title>
      <meta name="description" content={t('changelog.metaDescription')} />
      <link rel="canonical" href={url} />
      {alternateLinks(CHANGELOG_PATHS)}
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('changelog.metaTitle')} />
      <meta property="og:description" content={t('changelog.metaDescription')} />
      <meta name="twitter:title" content={t('changelog.metaTitle')} />
      <meta name="twitter:description" content={t('changelog.metaDescription')} />
    </Head>
  )
}

function LocalizedChangelog({ lng }: { lng: Language }) {
  return (
    <>
      <ChangelogHead lng={lng} />
      <Changelog />
    </>
  )
}

function ConvertHead({ lng, page }: { lng: Language; page: ConvertPage }) {
  const { t } = useTranslation()
  const paths = PAGES[page]
  const url = SITE + paths[lng]
  const faq = t(`${page}.faq.items`, { returnObjects: true }) as { q: string; a: string }[]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: t('meta.inLanguage'),
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t(`${page}.metaTitle`)}</title>
      <meta name="description" content={t(`${page}.metaDescription`)} />
      <link rel="canonical" href={url} />
      {alternateLinks(paths)}
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t(`${page}.metaTitle`)} />
      <meta property="og:description" content={t(`${page}.metaDescription`)} />
      <meta name="twitter:title" content={t(`${page}.metaTitle`)} />
      <meta name="twitter:description" content={t(`${page}.metaDescription`)} />
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
    </Head>
  )
}

function LocalizedConvert({ lng, page }: { lng: Language; page: ConvertPage }) {
  return (
    <>
      <ConvertHead lng={lng} page={page} />
      <ConvertPageView page={page} />
    </>
  )
}

function PrivacyHead({ lng }: { lng: Language }) {
  const { t } = useTranslation()
  const url = SITE + PRIVACY_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('privacy.metaTitle')}</title>
      <meta name="description" content={t('privacy.metaDescription')} />
      <link rel="canonical" href={url} />
      {alternateLinks(PRIVACY_PATHS)}
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('privacy.metaTitle')} />
      <meta property="og:description" content={t('privacy.metaDescription')} />
      <meta name="twitter:title" content={t('privacy.metaTitle')} />
      <meta name="twitter:description" content={t('privacy.metaDescription')} />
    </Head>
  )
}

function LocalizedPrivacy({ lng }: { lng: Language }) {
  return (
    <>
      <PrivacyHead lng={lng} />
      <Privacy />
    </>
  )
}

function StatsHead({ lng }: { lng: Language }) {
  const { t } = useTranslation()
  const url = SITE + STATS_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('stats.metaTitle')}</title>
      <meta name="description" content={t('stats.metaDescription')} />
      <link rel="canonical" href={url} />
      {alternateLinks(STATS_PATHS)}
      <meta property="og:locale" content={t('meta.ogLocale')} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={t('stats.metaTitle')} />
      <meta property="og:description" content={t('stats.metaDescription')} />
      <meta name="twitter:title" content={t('stats.metaTitle')} />
      <meta name="twitter:description" content={t('stats.metaDescription')} />
    </Head>
  )
}

function LocalizedStats({ lng }: { lng: Language }) {
  return (
    <>
      <StatsHead lng={lng} />
      <Stats />
    </>
  )
}

function NoIndex({ children }: { children: ReactNode }) {
  return (
    <>
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      {children}
    </>
  )
}

// Wraps every page so the analytics components load once across all routes (they
// render nothing during SSG and inject their client scripts after hydration).
function RootLayout() {
  return (
    <>
      <Outlet />
      <Analytics />
      <GoogleAnalytics />
    </>
  )
}

export const routes: RouteRecord[] = [
  {
    path: '/',
    element: <RootLayout />,
    entry: 'src/routes.tsx',
    children: [
      ...LANGUAGES.flatMap((lng) => [
        lng === 'es'
          ? { index: true, ...localized('es', <LocalizedApp lng="es" />) }
          : { path: PATHS[lng].slice(1), ...localized(lng, <LocalizedApp lng={lng} />) },
        ...(
          [
            [FEATURE_PATHS, LocalizedFeatures],
            [GUIDE_PATHS, LocalizedGuide],
            [USE_CASES_PATHS, LocalizedUseCases],
            [CHANGELOG_PATHS, LocalizedChangelog],
            [PRIVACY_PATHS, LocalizedPrivacy],
            [STATS_PATHS, LocalizedStats],
          ] as const
        ).map(([paths, Page]) => ({
          path: paths[lng].slice(1),
          ...localized(lng, <Page lng={lng} />, paths === CHANGELOG_PATHS),
        })),
        ...CONVERT_PAGES.map((page) => ({
          path: PAGES[page][lng].slice(1),
          ...localized(lng, <LocalizedConvert lng={lng} page={page} />),
        })),
      ]),
      ...recipePages().map((page) => ({
        path: page.path.slice(1),
        ...localized(page.lang, <LocalizedRecipe page={page} />),
      })),
      // Transactional pages PayPal redirects to after the donate flow: their copy is
      // self-contained and language-detected on the client, so they don't need the
      // localized App shell.
      {
        path: 'donate/cancel',
        element: (
          <NoIndex>
            <DonateCancel />
          </NoIndex>
        ),
        entry: 'src/routes.tsx',
      },
      {
        path: 'donate/completed',
        element: (
          <NoIndex>
            <DonateCompleted />
          </NoIndex>
        ),
        entry: 'src/routes.tsx',
      },
    ],
  },
]
