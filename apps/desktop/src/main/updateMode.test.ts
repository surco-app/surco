import { expect, it } from 'vitest'
import { updateMode } from './updateMode'

it('has no update feed in development', () => {
  expect(updateMode({ packaged: false, windowsStore: false })).toBe('dev')
})

// The Store installs Surco in a read-only folder and ships every update itself, so
// electron-updater would only fail there or offer a version it cannot install.
it('leaves updates to the Store when Surco runs from its package', () => {
  expect(updateMode({ packaged: true, windowsStore: true })).toBe('store')
})

it('updates itself everywhere else it is installed', () => {
  expect(updateMode({ packaged: true, windowsStore: false })).toBe('updater')
})
