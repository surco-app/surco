import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Reveal from './Reveal'
import DownloadButton from './DownloadButton'

const COMMAND = 'brew install --cask vigosan/surco/surco'

export default function InstallSection() {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  // Clipboard only exists on the client and on secure origins; the handler runs
  // on click, so prerendering stays untouched and a missing API just no-ops.
  const copy = () => {
    void navigator.clipboard?.writeText(COMMAND).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <section id="instalar" className="scroll-mt-24 pb-24">
      <Reveal>
        <p className="font-mono text-xs tracking-wider text-blue uppercase">{t('install.kicker')}</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{t('install.title')}</h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-pretty text-muted">{t('install.lede')}</p>
        <DownloadButton showAnalysis={false} showMeta={false} />
      </Reveal>

      <Reveal delay={120}>
        <div className="mt-10 max-w-2xl">
          <p className="font-mono text-xs tracking-wider text-faint uppercase">{t('install.or')}</p>
          <div className="inset-shadow-edge mt-3 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface2/50 px-5 py-4 transition-colors hover:border-blue/30">
            <code className="overflow-x-auto font-mono text-sm whitespace-nowrap text-fg">
              <span className="select-none text-faint">$ </span>
              {COMMAND}
            </code>
            <button
              type="button"
              onClick={copy}
              data-testid="copy-brew"
              aria-live="polite"
              className={`inline-flex shrink-0 justify-center rounded-lg border px-3 py-1.5 font-mono text-xs transition-[color,border-color,scale] duration-200 active:scale-[0.96] ${
                copied
                  ? 'border-green/50 text-green'
                  : 'border-line text-muted hover:border-blue/50 hover:text-fg'
              }`}
            >
              {copied ? t('install.copied') : t('install.copy')}
            </button>
          </div>
          <p className="mt-4 font-mono text-xs text-faint">{t('install.note')}</p>
        </div>
      </Reveal>
    </section>
  )
}
