import { describe, expect, it, vi } from 'vitest'
import { wireUpdateDelivery } from './updateDelivery'

type Listener = (info: { version: string }) => void

function fakeUpdater(): { on: (e: string, cb: Listener) => void; fire: (v: string) => void } {
  let listener: Listener | undefined
  return {
    on: (_e, cb) => {
      listener = cb
    },
    fire: (version) => listener?.({ version }),
  }
}

function fakeWindow(): { webContents: { send: ReturnType<typeof vi.fn> } } {
  return { webContents: { send: vi.fn() } }
}

describe('wireUpdateDelivery', () => {
  it('sends the downloaded version to the window alive at that moment', () => {
    const updater = fakeUpdater()
    const win = fakeWindow()
    wireUpdateDelivery(updater, () => win, vi.fn())
    updater.fire('0.35.1')
    expect(win.webContents.send).toHaveBeenCalledWith('update:downloaded', '0.35.1')
  })

  // The original bug: the launch window was captured once, so after ⌘W + reopen the
  // toast was sent to a destroyed window and every later release passed silently.
  // With no window alive at download time, the version must be replayed to the next
  // window that loads instead of being dropped.
  it('replays a version downloaded while no window existed to the next window', () => {
    const updater = fakeUpdater()
    let onLoaded: ((win: ReturnType<typeof fakeWindow>) => void) | undefined
    wireUpdateDelivery(
      updater,
      () => undefined,
      (cb) => {
        onLoaded = cb
      },
    )
    updater.fire('0.35.1')
    const reopened = fakeWindow()
    onLoaded?.(reopened)
    expect(reopened.webContents.send).toHaveBeenCalledWith('update:downloaded', '0.35.1')
  })

  it('does not ping a new window when nothing was downloaded', () => {
    const updater = fakeUpdater()
    let onLoaded: ((win: ReturnType<typeof fakeWindow>) => void) | undefined
    wireUpdateDelivery(
      updater,
      () => undefined,
      (cb) => {
        onLoaded = cb
      },
    )
    const reopened = fakeWindow()
    onLoaded?.(reopened)
    expect(reopened.webContents.send).not.toHaveBeenCalled()
  })
})
