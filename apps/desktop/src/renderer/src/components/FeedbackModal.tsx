import { Check } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalShell } from './ModalShell'

export const FEEDBACK_EMAIL_KEY = 'surco.feedbackEmail'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FIELD =
  'rounded-lg border border-[var(--color-input-border)] bg-[var(--color-field)] px-3 text-sm text-fg placeholder:text-fg-faint'
const SECONDARY =
  'press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-hover)]'
const PRIMARY =
  'press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:hover:bg-[var(--color-accent)]'

interface Props {
  error?: string
  stack?: string
  onClose: () => void
}

type Phase = 'form' | 'sending' | 'sent' | 'failed'

export function FeedbackModal({ error, stack, onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState(() => window.localStorage.getItem(FEEDBACK_EMAIL_KEY) ?? '')
  const [attachReport, setAttachReport] = useState(true)
  const [report, setReport] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [phase, setPhase] = useState<Phase>('form')

  const trimmedEmail = email.trim()
  const canSend =
    phase !== 'sending' && EMAIL.test(trimmedEmail) && (Boolean(error) || message.trim() !== '')

  const loadReport = async (): Promise<string> => {
    if (report !== null) return report
    const text = await window.api.feedbackReport(error, stack)
    setReport(text)
    return text
  }

  const send = async (): Promise<void> => {
    if (!canSend) return
    setPhase('sending')
    const outcome = await window.api.sendFeedback({
      email: trimmedEmail,
      message: message.trim(),
      attachReport,
      error,
      stack,
    })
    if (outcome === 'sent') window.localStorage.setItem(FEEDBACK_EMAIL_KEY, trimmedEmail)
    setPhase(outcome)
  }

  const togglePreview = (): void => {
    if (!previewOpen) void loadReport()
    setPreviewOpen(!previewOpen)
  }

  const copy = async (): Promise<void> => {
    const parts = [message.trim(), attachReport ? await loadReport() : ''].filter(Boolean)
    await window.api.copyText(parts.join('\n\n'))
    setCopied(true)
  }

  if (phase === 'sent') {
    return (
      <ModalShell
        onClose={onClose}
        backdropTestId="feedback-backdrop"
        labelledBy="feedback-title"
        className="flex w-[480px] flex-col items-center gap-3 rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6 pt-8 text-center"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-good)_14%,transparent)]">
          <Check className="h-5 w-5 text-good" aria-hidden="true" />
        </div>
        <h2 id="feedback-title" className="text-base font-semibold">
          {tr('feedback.sentTitle')}
        </h2>
        <p data-testid="feedback-sent" className="max-w-[340px] text-pretty text-sm text-fg-muted">
          {tr('feedback.sentBody', { email: trimmedEmail })}
        </p>
        <div className="mt-3 flex self-stretch justify-end border-t border-[var(--color-line)] pt-4">
          <button
            type="button"
            data-testid="feedback-close"
            onClick={onClose}
            className={SECONDARY}
          >
            {tr('feedback.close')}
          </button>
        </div>
      </ModalShell>
    )
  }

  if (phase === 'failed') {
    return (
      <ModalShell
        onClose={onClose}
        backdropTestId="feedback-backdrop"
        labelledBy="feedback-title"
        className="flex w-[480px] flex-col gap-4 rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="feedback-title" className="text-base font-semibold">
            {tr('feedback.failedTitle')}
          </h2>
          <p data-testid="feedback-failed" className="text-sm leading-relaxed text-fg-muted">
            {tr('feedback.failedBody')}
          </p>
        </div>
        <div className="flex flex-col gap-2.5 rounded-xl bg-[var(--color-ink)] p-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-[var(--color-accent)] select-text">
              hello@vicent.io
            </span>
            <button
              type="button"
              data-testid="feedback-copy"
              onClick={() => void copy()}
              className="press rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-hover)]"
            >
              {copied ? tr('feedback.copied') : tr('feedback.copy')}
            </button>
          </div>
          <p className="text-xs leading-relaxed text-fg-dim">{tr('feedback.copyHint')}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-line)] pt-4">
          <button
            type="button"
            data-testid="feedback-close"
            onClick={onClose}
            className={SECONDARY}
          >
            {tr('feedback.close')}
          </button>
          <button
            type="button"
            data-testid="feedback-retry"
            onClick={() => void send()}
            className={PRIMARY}
          >
            {tr('feedback.retry')}
          </button>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell
      onClose={onClose}
      onSubmit={() => void send()}
      backdropTestId="feedback-backdrop"
      labelledBy="feedback-title"
      className="flex w-[480px] flex-col gap-4 rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="feedback-title" className="text-base font-semibold">
          {tr(error ? 'feedback.titleError' : 'feedback.title')}
        </h2>
        <p className="text-balance text-sm leading-relaxed text-fg-muted">
          {tr(error ? 'feedback.ledeError' : 'feedback.lede')}
        </p>
      </div>

      {error && (
        <p
          data-testid="feedback-error"
          className="rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_28%,transparent)] bg-[var(--color-ink)] p-3 font-mono text-xs leading-relaxed break-words text-danger"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="feedback-message" className="text-xs font-medium text-fg-muted">
          {tr('feedback.message')}
          {error && <span className="font-normal text-fg-faint"> {tr('feedback.optional')}</span>}
        </label>
        <textarea
          id="feedback-message"
          data-testid="feedback-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={tr('feedback.messagePlaceholder')}
          className={`${FIELD} resize-none py-2.5 leading-relaxed ${error ? 'h-24' : 'h-32'}`}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="feedback-email" className="text-xs font-medium text-fg-muted">
          {tr('feedback.email')}{' '}
          <span className="font-normal text-fg-faint">{tr('feedback.emailHint')}</span>
        </label>
        <input
          id="feedback-email"
          data-testid="feedback-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${FIELD} h-9`}
        />
      </div>

      <div className="flex items-start gap-2.5 rounded-xl bg-[var(--color-ink)] p-3">
        <input
          id="feedback-attach"
          data-testid="feedback-attach"
          type="checkbox"
          checked={attachReport}
          onChange={(e) => setAttachReport(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
        />
        <div className="flex min-w-0 flex-col items-start gap-1">
          <label htmlFor="feedback-attach" className="text-sm">
            {tr('feedback.attach')}
          </label>
          <p className="text-xs leading-relaxed text-fg-dim">{tr('feedback.attachHint')}</p>
          <button
            type="button"
            data-testid="feedback-preview-toggle"
            aria-expanded={previewOpen}
            onClick={togglePreview}
            className="press text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          >
            {tr(previewOpen ? 'feedback.previewHide' : 'feedback.preview')}
          </button>
          {previewOpen && report !== null && (
            <pre
              data-testid="feedback-preview"
              className="mt-1 max-h-40 w-full overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] p-2.5 font-mono text-label leading-relaxed whitespace-pre-wrap break-words text-fg-dim"
            >
              {report}
            </pre>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] pt-4">
        <button
          type="button"
          data-testid="feedback-github"
          onClick={() => void window.api.openFeedback(error, stack)}
          className="press text-left text-xs text-fg-dim underline-offset-2 hover:text-fg hover:underline"
        >
          {tr('feedback.github')}
        </button>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            data-testid="feedback-cancel"
            onClick={onClose}
            className={SECONDARY}
          >
            {tr('common.cancel')}
          </button>
          <button type="submit" data-testid="feedback-send" disabled={!canSend} className={PRIMARY}>
            {tr(phase === 'sending' ? 'feedback.sending' : 'feedback.send')}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
