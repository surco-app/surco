// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import '../i18n'
import { installApi } from '../test/api'
import { FEEDBACK_EMAIL_KEY, FeedbackModal } from './FeedbackModal'

afterEach(cleanup)
beforeEach(() => window.localStorage.clear())

function setup(outcome: 'sent' | 'failed' = 'sent') {
  const sendFeedback = vi.fn<Api['sendFeedback']>(async () => outcome)
  const feedbackReport = vi.fn<Api['feedbackReport']>(async () => 'Surco 1.32.1 · macOS')
  const copyText = vi.fn<Api['copyText']>(async () => {})
  const openFeedback = vi.fn<Api['openFeedback']>(async () => {})
  installApi({ sendFeedback, feedbackReport, copyText, openFeedback })
  return { sendFeedback, feedbackReport, copyText, openFeedback }
}

function type(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } })
}

describe('FeedbackModal', () => {
  it('keeps Send off until there is a valid email, since a report nobody can answer is a dead end', () => {
    setup()
    render(<FeedbackModal onClose={() => {}} />)
    type('feedback-message', 'Se queda parado')
    expect(screen.getByTestId('feedback-send')).toBeDisabled()
    type('feedback-email', 'djotas')
    expect(screen.getByTestId('feedback-send')).toBeDisabled()
    type('feedback-email', 'djotas@example.com')
    expect(screen.getByTestId('feedback-send')).toBeEnabled()
  })

  it('asks for a message when there is no error to report', () => {
    setup()
    render(<FeedbackModal onClose={() => {}} />)
    type('feedback-email', 'djotas@example.com')
    expect(screen.getByTestId('feedback-send')).toBeDisabled()
  })

  it('lets a report from a failure go without a message, because the error already says what broke', () => {
    setup()
    render(<FeedbackModal error="Invalid data found when processing input" onClose={() => {}} />)
    expect(screen.getByTestId('feedback-error')).toHaveTextContent(
      'Invalid data found when processing input',
    )
    type('feedback-email', 'djotas@example.com')
    expect(screen.getByTestId('feedback-send')).toBeEnabled()
  })

  it('sends the form and confirms with the address the reply will go to', async () => {
    const { sendFeedback } = setup()
    render(<FeedbackModal error="boom" stack="at x" onClose={() => {}} />)
    type('feedback-message', 'Convertía a AIFF')
    type('feedback-email', ' djotas@example.com ')
    fireEvent.click(screen.getByTestId('feedback-send'))

    expect(await screen.findByTestId('feedback-sent')).toHaveTextContent('djotas@example.com')
    expect(sendFeedback).toHaveBeenCalledWith({
      email: 'djotas@example.com',
      message: 'Convertía a AIFF',
      attachReport: true,
      error: 'boom',
      stack: 'at x',
    })
  })

  it('sends no report when the user unticks it', async () => {
    const { sendFeedback } = setup()
    render(<FeedbackModal onClose={() => {}} />)
    type('feedback-message', 'Hola')
    type('feedback-email', 'djotas@example.com')
    fireEvent.click(screen.getByTestId('feedback-attach'))
    fireEvent.click(screen.getByTestId('feedback-send'))
    await screen.findByTestId('feedback-sent')
    expect(sendFeedback.mock.calls[0][0].attachReport).toBe(false)
  })

  it('remembers the email after a send so the next report does not ask again', async () => {
    setup()
    render(<FeedbackModal onClose={() => {}} />)
    type('feedback-message', 'Hola')
    type('feedback-email', 'djotas@example.com')
    fireEvent.click(screen.getByTestId('feedback-send'))
    await screen.findByTestId('feedback-sent')
    cleanup()

    render(<FeedbackModal onClose={() => {}} />)
    expect(screen.getByTestId('feedback-email')).toHaveValue('djotas@example.com')
    expect(window.localStorage.getItem(FEEDBACK_EMAIL_KEY)).toBe('djotas@example.com')
  })

  it('keeps the text when sending fails and offers retry, so nothing typed is lost', async () => {
    const { sendFeedback } = setup('failed')
    render(<FeedbackModal onClose={() => {}} />)
    type('feedback-message', 'Hola')
    type('feedback-email', 'djotas@example.com')
    fireEvent.click(screen.getByTestId('feedback-send'))
    await screen.findByTestId('feedback-failed')

    sendFeedback.mockResolvedValueOnce('sent')
    fireEvent.click(screen.getByTestId('feedback-retry'))
    await screen.findByTestId('feedback-sent')
    expect(sendFeedback).toHaveBeenCalledTimes(2)
    expect(sendFeedback.mock.calls[1][0].message).toBe('Hola')
  })

  it('copies the message and the report together when it cannot be sent, ready to paste in a mail', async () => {
    const { copyText } = setup('failed')
    render(<FeedbackModal onClose={() => {}} />)
    type('feedback-message', 'Hola')
    type('feedback-email', 'djotas@example.com')
    fireEvent.click(screen.getByTestId('feedback-send'))
    fireEvent.click(await screen.findByTestId('feedback-copy'))
    await vi.waitFor(() => expect(copyText).toHaveBeenCalledWith('Hola\n\nSurco 1.32.1 · macOS'))
  })

  it('shows the report before sending so the user knows what leaves the machine', async () => {
    const { feedbackReport } = setup()
    render(<FeedbackModal error="boom" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('feedback-preview-toggle'))
    expect(await screen.findByTestId('feedback-preview')).toHaveTextContent('Surco 1.32.1 · macOS')
    expect(feedbackReport).toHaveBeenCalledWith('boom', undefined)
  })

  it('still offers the public GitHub route with the same error', () => {
    const { openFeedback } = setup()
    render(<FeedbackModal error="boom" stack="at x" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('feedback-github'))
    expect(openFeedback).toHaveBeenCalledWith('boom', 'at x')
  })
})
