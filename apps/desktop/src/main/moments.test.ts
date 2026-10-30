import { describe, expect, it, vi } from 'vitest'
import type { CopyReason, DjProgram } from '../shared/types'
import { createMoments } from './moments'
import { createSessionBackup, type SessionBackup } from './rekordboxSessionBackup'

function fakeSession(): SessionBackup {
  return {
    ensure: vi.fn(),
    begin: vi.fn(),
    beginLoose: vi.fn(),
    inRunFlush: vi.fn(),
    failed: () => new Set(),
  }
}

function fakeSessions(): Record<DjProgram, SessionBackup> {
  return { rekordbox: fakeSession(), traktor: fakeSession(), engine: fakeSession() }
}

function recorded() {
  const labels: string[] = []
  const session = () =>
    createSessionBackup({
      take: async (path, _companions, reason: CopyReason) => {
        labels.push(`${path} ${reason}`)
        return {} as never
      },
    })
  const sessions = { rekordbox: session(), traktor: session(), engine: session() }
  return { labels, sessions, moments: createMoments(sessions) }
}

describe('moments', () => {
  it('begin fans out to every program so a review touching three libraries copies all three', () => {
    const sessions = fakeSessions()
    createMoments(sessions).begin('review')
    for (const s of Object.values(sessions)) expect(s.begin).toHaveBeenCalledWith('review')
  })

  it('begin for some programs leaves the others in the momento they are in', () => {
    const sessions = fakeSessions()
    createMoments(sessions).begin('queue', ['traktor'])
    expect(sessions.traktor.begin).toHaveBeenCalledWith('queue')
    expect(sessions.rekordbox.begin).not.toHaveBeenCalled()
    expect(sessions.engine.begin).not.toHaveBeenCalled()
  })

  it('beginLoose fans out to every program so whichever owns the path labels its copy', () => {
    const sessions = fakeSessions()
    createMoments(sessions).beginLoose('/lib/a')
    for (const s of Object.values(sessions)) expect(s.beginLoose).toHaveBeenCalledWith('/lib/a')
  })

  it('a playlist edit after a cues momento is labelled playlists, not the stale cues', async () => {
    const { labels, sessions, moments } = recorded()
    moments.begin('cues')
    moments.beginLoose('/lib/a')
    await sessions.rekordbox.ensure('/lib/a')
    expect(labels).toEqual(['/lib/a playlists'])
  })

  it("a cue save in another program does not cost the session's playlist copy a second one", async () => {
    const { labels, sessions, moments } = recorded()
    moments.beginLoose('/dj/master.db')
    await sessions.rekordbox.ensure('/dj/master.db')
    moments.begin('cues', ['engine'])
    moments.beginLoose('/dj/master.db')
    await sessions.rekordbox.ensure('/dj/master.db')
    expect(labels).toEqual(['/dj/master.db playlists'])
  })

  it('a momento that never wrote the collection keeps the playlist edits on one copy', async () => {
    const { labels, sessions, moments } = recorded()
    moments.beginLoose('/dj/master.db')
    await sessions.rekordbox.ensure('/dj/master.db')
    moments.begin('review')
    moments.beginLoose('/dj/master.db')
    await sessions.rekordbox.ensure('/dj/master.db')
    expect(labels).toEqual(['/dj/master.db playlists'])
  })

  it('a playlist edit after a momento that wrote the collection takes a fresh copy, so the copy before it is not lost', async () => {
    const { labels, sessions, moments } = recorded()
    moments.beginLoose('/dj/master.db')
    await sessions.rekordbox.ensure('/dj/master.db')
    moments.begin('queue', ['rekordbox'])
    await sessions.rekordbox.ensure('/dj/master.db')
    moments.beginLoose('/dj/master.db')
    await sessions.rekordbox.ensure('/dj/master.db')
    expect(labels).toEqual([
      '/dj/master.db playlists',
      '/dj/master.db queue',
      '/dj/master.db playlists',
    ])
  })

  it("a rekordbox queue flush during a run does not start a new momento for Engine's run writes", async () => {
    const { labels, sessions, moments } = recorded()
    moments.begin('run')
    await sessions.engine.ensure('/dj/m.db')
    moments.begin('queue', ['rekordbox'])
    await sessions.engine.ensure('/dj/m.db')
    expect(labels).toEqual(['/dj/m.db run'])
  })

  it("a momento begun between a run's start and its flush does not swallow the run's writes", async () => {
    const { labels, sessions, moments } = recorded()
    moments.begin('run')
    moments.begin('cues', ['rekordbox'])
    await sessions.rekordbox.ensure('/dj/master.db')
    await moments.duringRunFlush(() => sessions.rekordbox.ensure('/dj/master.db'))
    expect(labels).toEqual(['/dj/master.db cues', '/dj/master.db run'])
  })

  it("the run's flush does not copy again what the run already copied", async () => {
    const { labels, sessions, moments } = recorded()
    moments.begin('run')
    await sessions.engine.ensure('/dj/m.db')
    moments.begin('review')
    await moments.duringRunFlush(() => sessions.engine.ensure('/dj/m.db'))
    expect(labels).toEqual(['/dj/m.db run'])
  })

  it('writes after the run flush belong to the momento in progress again', async () => {
    const { labels, sessions, moments } = recorded()
    moments.begin('run')
    moments.begin('cues', ['rekordbox'])
    await moments.duringRunFlush(() => sessions.rekordbox.ensure('/dj/master.db'))
    await sessions.rekordbox.ensure('/dj/master.db')
    expect(labels).toEqual(['/dj/master.db run', '/dj/master.db cues'])
  })

  it('a waiting playlist label does not survive a later momento', async () => {
    const { labels, sessions, moments } = recorded()
    moments.beginLoose('/dj/master.db')
    moments.begin('cues', ['rekordbox'])
    await sessions.rekordbox.ensure('/dj/master.db')
    expect(labels).toEqual(['/dj/master.db cues'])
  })

  it('can be passed around detached, as the IPC modules receive it', () => {
    const sessions = fakeSessions()
    const { begin, beginLoose } = createMoments(sessions)
    begin('cues')
    beginLoose('/lib/a')
    expect(sessions.rekordbox.begin).toHaveBeenCalledWith('cues')
    expect(sessions.rekordbox.beginLoose).toHaveBeenCalledWith('/lib/a')
  })
})
