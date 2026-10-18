import { useEffect, useState } from 'react'
import { HOME } from '../lib/nav'

// PayPal sends donors here after a completed donation. Thank them properly and
// celebrate: two confetti volleys rise from the bottom corners toward the center.
// canvas-confetti touches window at import time, so it's loaded inside the effect —
// the SSG pass never sees it. Self-contained localized copy, like DonateCancel.
const COPY = {
  es: {
    title: '¡Gracias de corazón!',
    body: 'Tu donación es lo que mantiene Surco vivo: horas de desarrollo, nuevas funciones y cero suscripciones. Que te ahorre muchas horas de cabina.',
    home: 'Volver al inicio',
  },
  en: {
    title: 'Thank you so much!',
    body: 'Your donation is what keeps Surco alive: development hours, new features and zero subscriptions. May it save you many booth hours.',
    home: 'Back to home',
  },
  ja: {
    title: '本当にありがとうございます！',
    body: '皆さまの寄付が Surco を支えています。開発に取り組む時間も、新機能も、サブスクリプションなしでの提供も、そのおかげです。DJ ブースでの作業時間をたくさん節約できますように。',
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

// The site's own accents, in the hex canvas-confetti needs; left alone it throws its
// neon rainbow, which is no colour of the palette.
const CONFETTI = ['#7aa2f7', '#7dcfff', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e']

export default function DonateCompleted() {
  const lng = useLang()
  const t = COPY[lng]

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    import('canvas-confetti').then(({ default: confetti }) => {
      if (cancelled) return
      const volley = (): void => {
        confetti({
          particleCount: 70,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 1 },
          colors: CONFETTI,
        })
        confetti({
          particleCount: 70,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 1 },
          colors: CONFETTI,
        })
      }
      volley()
      timers.push(setTimeout(volley, 350), setTimeout(volley, 700))
    })
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16 text-fg">
      <a href={HOME[lng]} className="mb-6 inline-block w-fit">
        <img src="/logo.svg" alt="Surco" width={48} height={48} className="h-14 w-14" />
      </a>
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">{t.body}</p>
      <a href={HOME[lng]} className="mt-10 text-sm text-faint transition-colors hover:text-blue">
        ← {t.home}
      </a>
    </main>
  )
}
