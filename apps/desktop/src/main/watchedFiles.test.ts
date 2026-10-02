import { describe, expect, it, vi } from 'vitest'
import { createMediaAccess } from './mediaAccess'
import { onWatchedFilesChanged } from './watchedFiles'

describe('onWatchedFilesChanged', () => {
  // The bug this guards: a watched folder's late-arriving tracks are added to the list and
  // shown in the player, but pressing play did nothing — the surco:// handler 403s any path
  // the app never registered, and the watcher reported new files without granting them. So
  // before telling the renderer about them, every reported path must be allowed for playback.
  it('grants the reported files media access before notifying the renderer', () => {
    const media = createMediaAccess()
    const send = vi.fn()
    const files = ['/music/new1.flac', '/music/new2.wav']

    onWatchedFilesChanged(media, () => false, send, '/music', files)

    expect(media.isAllowed('/music/new1.flac')).toBe(true)
    expect(media.isAllowed('/music/new2.wav')).toBe(true)
  })

  it('forwards the root and files to the renderer', () => {
    const media = createMediaAccess()
    const send = vi.fn()
    const files = ['/music/new1.flac']

    onWatchedFilesChanged(media, () => false, send, '/music', files)

    expect(send).toHaveBeenCalledWith('/music', files)
  })

  // Access must be granted FIRST: if the renderer raced a play before the grant landed, the
  // handler would still 403. Order matters, so assert the grant precedes the notify.
  it('grants access before it notifies', () => {
    const media = createMediaAccess()
    const order: string[] = []
    const trackingMedia = {
      ...media,
      allowAll: (paths: string[]) => {
        order.push('grant')
        media.allowAll(paths)
      },
    }
    const send = vi.fn(() => order.push('notify'))

    onWatchedFilesChanged(trackingMedia, () => false, send, '/music', ['/music/x.flac'])

    expect(order).toEqual(['grant', 'notify'])
  })

  // An export rewrites the track in its own folder under its new name, then keeps the job
  // open while Apple Music imports or syncs it — seconds per track. The watcher saw the
  // renamed file land, but the row still pointed at the old name, so updating the tags of
  // nine AIFFs offered the same nine back as "9 new tracks". A path a running job claimed
  // is Surco's own write, never a newcomer.
  it('leaves out the files a running conversion is still writing', () => {
    const media = createMediaAccess()
    const send = vi.fn()
    const writing = '/music/Artist - Title.aiff'

    onWatchedFilesChanged(media, (p) => p === writing, send, '/music', [
      writing,
      '/music/dropped.flac',
    ])

    expect(send).toHaveBeenCalledWith('/music', ['/music/dropped.flac'])
  })
})
