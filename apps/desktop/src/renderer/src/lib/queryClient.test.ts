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
})
