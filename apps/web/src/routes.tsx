import { Analytics } from '@vercel/analytics/react'
import type { RouteRecord } from 'vite-react-ssg'
import { Head } from 'vite-react-ssg'
import { I18nextProvider } from 'react-i18next'
import { Outlet } from 'react-router-dom'
import type { i18n } from 'i18next'
import App from './App'
import DonateCancel from './components/DonateCancel'
import DonateCompleted from './components/DonateCompleted'
import Guide from './components/Guide'
import Changelog from './components/Changelog'
import { createI18n, type Language } from './i18n'

const SITE = 'https://getsurco.app'
const PATHS: Record<Language, string> = { es: '/', en: '/en' }
const GUIDE_PATHS: Record<Language, string> = { es: '/guia', en: '/en/guide' }
const CHANGELOG_PATHS: Record<Language, string> = { es: '/cambios', en: '/en/changelog' }

const I18N: Record<Language, i18n> = { es: createI18n('es'), en: createI18n('en') }

function DocumentHead({ lng }: { lng: Language }) {
  const t = I18N[lng].getFixedT(lng)
  const url = SITE + PATHS[lng]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Surco',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'macOS, Windows',
    url,
    image: `${SITE}/og.png`,
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
      <link rel="alternate" hrefLang="es" href={`${SITE}/`} />
      <link rel="alternate" hrefLang="en" href={`${SITE}/en`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE}/`} />
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
    <I18nextProvider i18n={I18N[lng]}>
      <DocumentHead lng={lng} />
      <App />
    </I18nextProvider>
  )
}

function GuideHead({ lng }: { lng: Language }) {
  const t = I18N[lng].getFixedT(lng)
  const url = SITE + GUIDE_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('guide.metaTitle')}</title>
      <meta name="description" content={t('guide.metaDescription')} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="es" href={`${SITE}${GUIDE_PATHS.es}`} />
      <link rel="alternate" hrefLang="en" href={`${SITE}${GUIDE_PATHS.en}`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE}${GUIDE_PATHS.es}`} />
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
    <I18nextProvider i18n={I18N[lng]}>
      <GuideHead lng={lng} />
      <Guide />
    </I18nextProvider>
  )
}

function ChangelogHead({ lng }: { lng: Language }) {
  const t = I18N[lng].getFixedT(lng)
  const url = SITE + CHANGELOG_PATHS[lng]
  return (
    <Head>
      <html lang={t('meta.htmlLang')} />
      <title>{t('changelog.metaTitle')}</title>
      <meta name="description" content={t('changelog.metaDescription')} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="es" href={`${SITE}${CHANGELOG_PATHS.es}`} />
      <link rel="alternate" hrefLang="en" href={`${SITE}${CHANGELOG_PATHS.en}`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE}${CHANGELOG_PATHS.es}`} />
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
    <I18nextProvider i18n={I18N[lng]}>
      <ChangelogHead lng={lng} />
      <Changelog />
    </I18nextProvider>
  )
}

// Wraps every page so Vercel Analytics loads once across all routes (it renders
// nothing during SSG and injects the client script after hydration).
function RootLayout() {
  return (
    <>
      <Outlet />
      <Analytics />
    </>
  )
}

export const routes: RouteRecord[] = [
  {
    path: '/',
    element: <RootLayout />,
    entry: 'src/routes.tsx',
    children: [
      { index: true, element: <LocalizedApp lng="es" />, entry: 'src/routes.tsx' },
      { path: 'en', element: <LocalizedApp lng="en" />, entry: 'src/routes.tsx' },
      { path: 'guia', element: <LocalizedGuide lng="es" />, entry: 'src/routes.tsx' },
      { path: 'en/guide', element: <LocalizedGuide lng="en" />, entry: 'src/routes.tsx' },
      { path: 'cambios', element: <LocalizedChangelog lng="es" />, entry: 'src/routes.tsx' },
      { path: 'en/changelog', element: <LocalizedChangelog lng="en" />, entry: 'src/routes.tsx' },
      // Transactional pages PayPal redirects to after the donate flow: their copy is
      // self-contained and language-detected on the client, so they don't need the
      // localized App shell.
      { path: 'donate/cancel', element: <DonateCancel />, entry: 'src/routes.tsx' },
      { path: 'donate/completed', element: <DonateCompleted />, entry: 'src/routes.tsx' },
    ],
  },
]
