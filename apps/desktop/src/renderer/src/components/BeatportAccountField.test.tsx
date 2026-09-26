// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import i18n from '../i18n'
import { installApi, testSettings } from '../test/api'
import { BeatportAccountField } from './BeatportAccountField'

beforeAll(() => i18n.changeLanguage('es'))
afterEach(cleanup)

function type(testid: string, value: string) {
  fireEvent.change(screen.getByTestId(testid), { target: { value } })
}

describe('BeatportAccountField', () => {
  it('connects with the typed account and hands back the saved settings', async () => {
    const saved = { ...testSettings, beatportUsername: 'dj' }
    const beatportConnect = vi.fn<Api['beatportConnect']>().mockResolvedValue(saved)
    installApi({ beatportConnect })
    const onChange = vi.fn()
    render(<BeatportAccountField username="" disabled={false} onChange={onChange} />)
    type('beatport-username', 'dj')
    type('beatport-password', 'secret')
    fireEvent.click(screen.getByTestId('beatport-connect'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved))
    expect(beatportConnect).toHaveBeenCalledWith('dj', 'secret')
  })

  it('shows who is connected instead of the login form', () => {
    installApi()
    render(<BeatportAccountField username="dj" disabled={false} onChange={vi.fn()} />)
    expect(screen.getByTestId('beatport-connected')).toHaveTextContent('dj')
    expect(screen.queryByTestId('beatport-password')).not.toBeInTheDocument()
  })

  it('a refused account says so under the field and stores nothing', async () => {
    installApi({
      beatportConnect: vi
        .fn<Api['beatportConnect']>()
        .mockRejectedValue(new Error('SURCO_ERR:beatportBadCredentials')),
    })
    const onChange = vi.fn()
    render(<BeatportAccountField username="" disabled={false} onChange={onChange} />)
    type('beatport-username', 'dj')
    type('beatport-password', 'wrong')
    fireEvent.click(screen.getByTestId('beatport-connect'))
    expect(await screen.findByTestId('beatport-error')).toHaveTextContent(
      i18n.t('errors.beatportBadCredentials'),
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the button is disabled while Beatport checks the account, so it cannot fire twice', async () => {
    let finish: (s: typeof testSettings) => void = () => {}
    const beatportConnect = vi
      .fn<Api['beatportConnect']>()
      .mockReturnValue(new Promise((resolve) => (finish = resolve)))
    installApi({ beatportConnect })
    render(<BeatportAccountField username="" disabled={false} onChange={vi.fn()} />)
    type('beatport-username', 'dj')
    type('beatport-password', 'secret')
    fireEvent.click(screen.getByTestId('beatport-connect'))
    expect(screen.getByTestId('beatport-connect')).toBeDisabled()
    fireEvent.click(screen.getByTestId('beatport-connect'))
    expect(beatportConnect).toHaveBeenCalledTimes(1)
    await act(async () => finish(testSettings))
  })

  it('disconnect clears the account', async () => {
    const beatportDisconnect = vi.fn<Api['beatportDisconnect']>().mockResolvedValue(testSettings)
    installApi({ beatportDisconnect })
    const onChange = vi.fn()
    render(<BeatportAccountField username="dj" disabled={false} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('beatport-disconnect'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(testSettings))
  })

  it('the section stays visible but disabled while Beatport is not a chosen source', () => {
    installApi()
    render(<BeatportAccountField username="" disabled onChange={vi.fn()} />)
    expect(screen.getByTestId('beatport-username')).toBeDisabled()
    expect(screen.getByTestId('beatport-password')).toBeDisabled()
    expect(screen.getByTestId('beatport-connect')).toBeDisabled()
  })
})
