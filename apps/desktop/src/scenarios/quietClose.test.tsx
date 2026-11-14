// @vitest-environment jsdom
import log from 'electron-log/main'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import { openApp } from './app'

function consoleWrites() {
  return vi.spyOn(log.transports.console, 'writeFn').mockImplementation(() => {})
}

describe('A scenario that closes the app does not leave a log on its way to vitest', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps what main logs while the app closes off the console', async () => {
    const surco = await openApp({ settings: {} })
    const write = consoleWrites()
    surco.close()
    log.info('a track browsed away while closing')
    expect(write).not.toHaveBeenCalled()
  })

  it('logs to the console again once the next app opens', async () => {
    const surco = await openApp({ settings: {} })
    const write = consoleWrites()
    log.info('the next scenario is running')
    expect(write).toHaveBeenCalled()
    surco.close()
  })
})
