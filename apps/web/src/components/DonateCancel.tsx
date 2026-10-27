import { useEffect, useState } from 'react'
import { DONATE_URL, PAYPAL_ME_LABEL, PAYPAL_ME_URL } from '../config'
import { trackDonate } from '../lib/analytics'
import { HOME } from '../lib/nav'

// PayPal sends donors here when they back out of the donate flow. Thank them for
// considering it and leave the door open — no guilt, one retry link. Self-contained
// localized copy keeps it off the marketing i18n, like the other transactional pages.
const COPY = {
  es: {
    title: 'No se ha completado la donación',
    body: 'No pasa nada — gracias por habértelo planteado. Surco es gratis; son las donaciones las que mantienen su desarrollo activo. Si algún día te ahorra unas horas, el botón seguirá aquí.',
    retry: 'Donar con PayPal',
    paypalMe: 'O sin comisión, entre amigos:',
    home: 'Volver al inicio',
  },
  en: {
    title: 'Your donation was cancelled',
    body: 'No worries — thanks for even considering it. Surco is free; donations are what keep its development going. If it ever saves you a few hours, the button will still be here.',
    retry: 'Donate with PayPal',
    paypalMe: 'Or fee-free, as a friend:',
    home: 'Back to home',
  },
  ja: {
    title: '寄付がキャンセルされました',
    body: 'お気になさらないでください。ご検討いただきありがとうございます。Surco は無料で、皆さまの寄付が開発を支えています。いつか数時間の節約に役立ったときには、いつでもこのボタンからご支援いただけます。',
    retry: 'PayPal で寄付する',
    paypalMe: 'または「友達」への送金として、手数料なしで：',
    home: 'ホームへ戻る',
  },
}

// Detected after hydration: Node ≥21 defines a global navigator, so a render-time
// check would leak the build machine's language into the prerendered HTML.
function useLang(): keyof typeof COPY {
  const [lng, setLng] = useState<keyof typeof COPY>('es')
  useEffect(() => {
    if (navigator.language.toLowerCase().startsWith('en')) setLng('en')
    if (navigator.language.toLowerCase().startsWith('ja')) setLng('ja')
  }, [])
  return lng
}

export default function DonateCancel() {
  const lng = useLang()
  const t = COPY[lng]

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16 text-fg">
      <a href={HOME[lng]} className="mb-6 inline-block w-fit">
        <img src="/logo.svg" alt="Surco" width={48} height={48} className="h-14 w-14" />
      </a>
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">{t.body}</p>
      <a
        href={DONATE_URL}
        onClick={() => trackDonate('donate-retry')}
        className="mt-6 inline-flex w-fit items-center rounded-full border border-line px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-blue/50 hover:text-blue"
      >
        {t.retry} →
      </a>
      <p className="mt-3 text-xs text-faint">
        {t.paypalMe}{' '}
        <a
          href={PAYPAL_ME_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted underline underline-offset-2 transition-colors hover:text-blue"
        >
          {PAYPAL_ME_LABEL}
        </a>
      </p>
      <a href={HOME[lng]} className="mt-10 text-sm text-faint transition-colors hover:text-blue">
        ← {t.home}
      </a>
    </main>
  )
}
