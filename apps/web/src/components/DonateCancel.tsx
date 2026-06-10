import { useEffect, useState } from 'react'
import { DONATE_URL } from '../config'

// PayPal sends donors here when they back out of the donate flow. Thank them for
// considering it and leave the door open — no guilt, one retry link. Self-contained
// bilingual copy keeps it off the marketing i18n, like the other transactional pages.
const COPY = {
  es: {
    title: 'No se ha completado la donación',
    body: 'No pasa nada — gracias por habértelo planteado. Surco es gratis y lo seguirá siendo; son las donaciones las que mantienen su desarrollo activo. Si algún día te ahorra unas horas, el botón seguirá aquí.',
    retry: 'Donar con PayPal',
    home: 'Volver al inicio',
  },
  en: {
    title: 'Your donation was cancelled',
    body: "No worries — thanks for even considering it. Surco is free and will stay free; donations are what keep its development going. If it ever saves you a few hours, the button will still be here.",
    retry: 'Donate with PayPal',
    home: 'Back to home',
  },
}

// Detected after hydration: Node ≥21 defines a global navigator, so a render-time
// check would leak the build machine's language into the prerendered HTML.
function useLang(): 'es' | 'en' {
  const [lng, setLng] = useState<'es' | 'en'>('es')
  useEffect(() => {
    if (navigator.language.toLowerCase().startsWith('en')) setLng('en')
  }, [])
  return lng
}

export default function DonateCancel() {
  const t = COPY[useLang()]

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16 text-fg">
      <a href="/" className="mb-6 inline-block w-fit">
        <img src="/icon.png" alt="Surco" className="h-14 w-14" />
      </a>
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">{t.body}</p>
      <a
        href={DONATE_URL}
        className="mt-6 inline-flex w-fit items-center rounded-full border border-line px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-blue/50 hover:text-blue"
      >
        {t.retry} →
      </a>
      <a href="/" className="mt-10 text-sm text-faint transition-colors hover:text-blue">
        ← {t.home}
      </a>
    </main>
  )
}
