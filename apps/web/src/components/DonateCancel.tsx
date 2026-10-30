import { useEffect, useState } from 'react'
import { DONATE_URL, PAYPAL_ME_LABEL, PAYPAL_ME_URL } from '../config'
import { LANGUAGES, type Language } from '../i18n'
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
  de: {
    title: 'Deine Spende wurde abgebrochen',
    body: 'Kein Problem, danke, dass du darüber nachgedacht hast. Surco ist kostenlos, und Spenden halten seine Entwicklung am Laufen. Wenn es dir eines Tages ein paar Stunden spart, ist der Button immer noch hier.',
    retry: 'Mit PayPal spenden',
    paypalMe: 'Oder ohne Gebühren, unter Freunden:',
    home: 'Zur Startseite',
  },
  fr: {
    title: 'Ton don n’a pas abouti',
    body: 'Pas de souci, merci d’y avoir pensé. Surco est gratuit, et ce sont les dons qui font avancer son développement. Si un jour il te fait gagner quelques heures, le bouton sera toujours là.',
    retry: 'Faire un don avec PayPal',
    paypalMe: 'Ou sans frais, entre amis :',
    home: 'Retour à l’accueil',
  },
  'pt-BR': {
    title: 'A doação não foi concluída',
    body: 'Tudo bem, obrigado por ter pensado nisso. O Surco é gratuito, e são as doações que mantêm o desenvolvimento ativo. Se um dia ele te poupar algumas horas, o botão continuará aqui.',
    retry: 'Doar com PayPal',
    paypalMe: 'Ou sem taxas, entre amigos:',
    home: 'Voltar ao início',
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
function useLang(): Language {
  const [lng, setLng] = useState<Language>('es')
  useEffect(() => {
    const base = navigator.language.toLowerCase().split('-')[0]
    setLng(LANGUAGES.find((l) => l.toLowerCase().split('-')[0] === base) ?? 'es')
  }, [])
  return lng
}

export default function DonateCancel() {
  const lng = useLang()
  const t = COPY[lng]

  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center px-6 py-16 text-fg">
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
