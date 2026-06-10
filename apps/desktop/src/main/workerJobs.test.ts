import { describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { runWorkerJob } from './workerJobs'

// The dispatcher is the worker-side contract: each job type must reach its real
// implementation with the caller's exact arguments, because a silent mismatch here
// would corrupt files (writeTags) or return analysis for the wrong parameters.
vi.mock('./tempo', () => ({ detectBpm: vi.fn(() => ({ bpm: 128, confidence: 0.9 })) }))
vi.mock('./musicalKey', () => ({ detectKey: vi.fn(() => ({ key: 'Am', confidence: 0.8 })) }))
vi.mock('./tags', () => ({ writeTags: vi.fn(), copyCueFrames: vi.fn() }))

import { detectKey } from './musicalKey'
import { copyCueFrames, writeTags } from './tags'
import { detectBpm } from './tempo'

describe('runWorkerJob', () => {
  it('routes bpm jobs to the tempo detector with the job pcm and rate', () => {
    const pcm = new Float32Array([0.1, 0.2])
    const out = runWorkerJob({ type: 'bpm', pcm, sampleRate: 11025 })
    expect(detectBpm).toHaveBeenCalledWith(pcm, 11025)
    expect(out).toEqual({ bpm: 128, confidence: 0.9 })
  })

  it('routes key jobs to the key detector with the job pcm and rate', () => {
    const pcm = new Float32Array([0.3])
    const out = runWorkerJob({ type: 'key', pcm, sampleRate: 11025 })
    expect(detectKey).toHaveBeenCalledWith(pcm, 11025)
    expect(out).toEqual({ key: 'Am', confidence: 0.8 })
  })

  it('routes tag writes with the full file/meta/cover arguments', () => {
    const meta = { title: 'T' } as TrackMetadata
    runWorkerJob({ type: 'writeTags', file: '/out/a.aiff', meta, coverPath: '/c.jpg' })
    expect(writeTags).toHaveBeenCalledWith('/out/a.aiff', meta, '/c.jpg', undefined)
  })

  it('routes cue copies with source and destination in order', () => {
    runWorkerJob({ type: 'copyCueFrames', source: '/in.mp3', dest: '/out.mp3' })
    expect(copyCueFrames).toHaveBeenCalledWith('/in.mp3', '/out.mp3')
  })
})
