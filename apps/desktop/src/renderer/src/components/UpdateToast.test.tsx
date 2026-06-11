// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import { UpdateToast } from './UpdateToast'

afterEach(cleanup)

function setApi(): { fireDownloaded: (v: string) => void; fireError: (e: string) => void } {
  let downloaded: (v: string) => void = () => {}
  let errored: (e: string) => void = () => {}
  ;(window as unknown as { api: unknown }).api = {
    onUpdateDownloaded: (cb: (v: string) => void) => {
      downloaded = cb
      return () => {}
    },
    onUpdateError: (cb: (e: string) => void) => {
      errored = cb
      return () => {}
    },
    installUpdate: () => {},
  }
  return { fireDownloaded: (v) => downloaded(v), fireError: (e) => errored(e) }
}

describe('UpdateToast', () => {
  // A transient network failure during an update download must not pin a red toast
  // over the corner for the rest of the session — the user can dismiss it.
  it('lets the user dismiss an update error', () => {
    const api = setApi()
    render(<UpdateToast />)
    act(() => api.fireError('net down'))
    expect(screen.getByTestId('update-error')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('update-error-dismiss'))
    expect(screen.queryByTestId('update-error')).toBeNull()
  })

  // electron-updater retries after a failed download; a success supersedes the stale
  // error, or the toast keeps reporting a failure it already recovered from.
  it('replaces a stale error once a download succeeds', () => {
    const api = setApi()
    render(<UpdateToast />)
    act(() => api.fireError('net down'))
    act(() => api.fireDownloaded('1.2.3'))
    expect(screen.queryByTestId('update-error')).toBeNull()
    expect(screen.getByTestId('update-restart')).toBeInTheDocument()
  })
})
