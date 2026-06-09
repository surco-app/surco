import { useEffect, useState } from 'react'

// The post-checkout page. Stripe redirects here with ?session_id=…; we poll the
// licensing API until the webhook has minted the key, then show it with activation
// instructions. The key is also emailed, so this page is a convenience, not the only
// delivery path. Self-contained bilingual copy keeps it off the marketing i18n.
const COPY = {
  es: {
    title: '¡Gracias por comprar Surco Pro!',
    pending: 'Estamos generando tu licencia…',
    keyLabel: 'Tu clave de licencia',
    copy: 'Copiar',
    copied: 'Copiado',
    howTo:
      'Abre Surco → pulsa ⌘K → «Surco Pro…» → pega la clave y el email de compra para activar. Funciona en hasta 3 dispositivos.',
    emailed: 'También te la hemos enviado por email.',
    error:
      'No hemos podido cargar tu licencia. Revisa tu email — te la hemos enviado — o recupérala abajo.',
    recover: 'Recuperar mi licencia',
    home: 'Volver al inicio',
  },
  en: {
    title: 'Thanks for buying Surco Pro!',
    pending: 'Generating your license…',
    keyLabel: 'Your license key',
    copy: 'Copy',
    copied: 'Copied',
    howTo:
      'Open Surco → press ⌘K → "Surco Pro…" → paste the key and your purchase email to activate. Works on up to 3 devices.',
    emailed: 'We have also emailed it to you.',
    error:
      "We couldn't load your license. Check your email — we've sent it — or recover it below.",
    recover: 'Recover my license',
    home: 'Back to home',
  },
}

function lang(): 'es' | 'en' {
  if (typeof navigator === 'undefined') return 'es'
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'es'
}

export default function CheckoutResult() {
  const t = COPY[lang()]
  const [status, setStatus] = useState<'pending' | 'ready' | 'error'>('pending')
  const [licenseKey, setLicenseKey] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get('session_id')
    if (!sessionId) {
      setStatus('error')
      return
    }
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    // The webhook usually lands within a second or two; poll a handful of times before
    // falling back to the "check your email" message.
    async function poll(): Promise<void> {
      try {
        const res = await fetch(`/api/license?session_id=${encodeURIComponent(sessionId as string)}`)
        if (res.status === 200) {
          const data = (await res.json()) as { key: string }
          setLicenseKey(data.key)
          setStatus('ready')
          return
        }
      } catch {
        // ignore and retry
      }
      if (++tries >= 8) {
        setStatus('error')
        return
      }
      timer = setTimeout(poll, 1500)
    }
    poll()
    return () => clearTimeout(timer)
  }, [])

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(licenseKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>

      {status === 'pending' && <p className="mt-4 text-muted">{t.pending}</p>}

      {status === 'ready' && (
        <div className="mt-6">
          <p className="font-mono text-xs tracking-wider text-blue uppercase">{t.keyLabel}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-line bg-surface px-4 py-3 font-mono text-sm break-all">
              {licenseKey}
            </code>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-lg border border-line px-4 py-3 text-sm font-medium transition-colors hover:border-blue/50 hover:text-blue"
            >
              {copied ? t.copied : t.copy}
            </button>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted">{t.howTo}</p>
          <p className="mt-2 text-sm text-faint">{t.emailed}</p>
        </div>
      )}

      {status === 'error' && (
        <div className="mt-6">
          <p className="text-sm leading-relaxed text-muted">{t.error}</p>
          <a href="/recover" className="mt-3 inline-block text-sm text-blue hover:text-cyan">
            {t.recover} →
          </a>
        </div>
      )}

      <a href="/" className="mt-10 text-sm text-faint transition-colors hover:text-blue">
        ← {t.home}
      </a>
    </main>
  )
}
