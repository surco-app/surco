import { describe, expect, it, vi } from 'vitest'
import { createMoments } from './moments'
import { createSessionBackup, type SessionBackup } from './rekordboxSessionBackup'

function fakeSession(): SessionBackup {
  return {
    ensure: vi.fn(),
    begin: vi.fn(),
    beginLoose: vi.fn(),
    failed: () => new Set(),
  }
}

describe('moments', () => {
  it('begin fans out to every program so a review touching three libraries copies all three', () => {
    const sessions = [fakeSession(), fakeSession(), fakeSession()]
    createMoments(sessions).begin('review')
    for (const s of sessions) expect(s.begin).toHaveBeenCalledWith('review')
  })

  it('beginLoose fans out to every program so whichever owns the path labels its copy', () => {
    const sessions = [fakeSession(), fakeSession()]
    createMoments(sessions).beginLoose('/lib/a')
    for (const s of sessions) expect(s.beginLoose).toHaveBeenCalledWith('/lib/a')
  })

  it('a playlist edit after a cues momento is labelled playlists, not the stale cues', () => {
    const labels: string[] = []
    const session = createSessionBackup({
      take: async (_path, _companions, reason) => {
        labels.push(reason)
        return {} as never
      },
    })
    const moments = createMoments([session])
    moments.begin('cues')
    moments.beginLoose('/lib/a')
    return session.ensure('/lib/a').then(() => expect(labels).toEqual(['playlists']))
  })

  it('can be passed around detached, as the IPC modules receive it', () => {
    const s = fakeSession()
    const { begin, beginLoose } = createMoments([s])
    begin('cues')
    beginLoose('/lib/a')
    expect(s.begin).toHaveBeenCalledWith('cues')
    expect(s.beginLoose).toHaveBeenCalledWith('/lib/a')
  })
})
