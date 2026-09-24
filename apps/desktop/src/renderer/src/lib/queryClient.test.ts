import { describe, expect, it } from 'vitest'
import { createQueryClient } from './queryClient'

describe('createQueryClient', () => {
  // The spectrogram's PNG is ~300 KB per track and is collected minutes after the editor
  // stops showing it, but the list's quality dot must outlive it: the verdict is filed
  // apart, image-free, so the dot stays for the session while the image is let go.
  it('files every spectrogram verdict apart, without the image', () => {
    const client = createQueryClient()

    client.setQueryData(['spectrogram', '/m/a.wav'], {
      image: 'data:image/png;base64,x',
      cutoffHz: 16000,
      sampleRateHz: 44100,
    })

    expect(client.getQueryData(['spectrumVerdict', '/m/a.wav'])).toEqual({
      cutoffHz: 16000,
      sampleRateHz: 44100,
    })
  })

  // Same for the channel scan: its per-channel lanes are ~400 KB a track and collectable,
  // but the list's clipping flag is one boolean and must stay for the session.
  it('files every channel scan verdict apart, as the clipping fact alone', () => {
    const client = createQueryClient()

    client.setQueryData(['waveformScan', '/m/a.wav'], {
      clipped: [false, true],
      channels: [{ peaks: [0.5, 1], clipped: [false, true] }],
    })
    client.setQueryData(['waveformScan', '/m/b.wav'], { clipped: [false, false] })

    expect(client.getQueryData(['scanVerdict', '/m/a.wav'])).toEqual({ clipping: true })
    expect(client.getQueryData(['scanVerdict', '/m/b.wav'])).toEqual({ clipping: false })
  })

  // A failed scan resolves null and claims nothing, so it files no verdict either.
  it('files no scan verdict for a failed scan', () => {
    const client = createQueryClient()

    client.setQueryData(['waveformScan', '/m/a.wav'], null)

    expect(client.getQueryData(['scanVerdict', '/m/a.wav'])).toBeUndefined()
  })
})
