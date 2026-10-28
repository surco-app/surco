import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type SectionLocation, trackBrewCopy } from '../lib/analytics'

const COMMAND = 'brew install --cask surco-app/surco/surco'

export default function BrewCommand({
  location,
  className = '',
}: {
  location: SectionLocation
  className?: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  // Clipboard only exists on the client and on secure origins; the handler runs
  // on click, so prerendering stays untouched and a missing API just no-ops.
  const copy = () => {
    void navigator.clipboard?.writeText(COMMAND).then(() => {
      // Counted inside the resolved promise, not on the click: a denied or absent
      // clipboard leaves the visitor without the command, and that is not an install.
      trackBrewCopy(location)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className={className}>
      <p className="text-sm font-medium text-faint">{t('install.or')}</p>
      <div className="inset-shadow-edge mt-3 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface2/50 px-4 py-4 transition-colors hover:border-blue/30">
        {/* Wraps at its spaces rather than scrolling: in the half-width card the box shows
            209 of the command's 362px, so a scroller read as "brew install --cask sur". */}
        <code className="min-w-0 font-mono text-sm break-words text-fg">
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
          <span key={String(copied)} className="label-pop inline-block">
            {copied ? t('install.copied') : t('install.copy')}
          </span>
        </button>
      </div>
      <p className="mt-4 text-sm text-faint">{t('install.note')}</p>
    </div>
  )
}
