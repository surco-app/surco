import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { removeAnalysisQueries } from './analysisQueries'

describe('removeAnalysisQueries', () => {
  // The renderer caches every per-path probe for the whole session on the premise that
  // a file's facts never change. An in-place rewrite or a removed track breaks the
  // premise for one path — eviction must clear that path's facts and only that path's.
  it('drops every probe family for the path and leaves other paths alone', () => {
    const client = new QueryClient()
    for (const key of ['properties', 'loudness', 'spectrogram', 'bpm', 'key']) {
      client.setQueryData([key, '/m/a.wav'], { fact: key })
      client.setQueryData([key, '/m/b.wav'], { fact: key })
    }

    removeAnalysisQueries(client, '/m/a.wav')

    for (const key of ['properties', 'loudness', 'spectrogram', 'bpm', 'key']) {
      expect(client.getQueryData([key, '/m/a.wav'])).toBeUndefined()
      expect(client.getQueryData([key, '/m/b.wav'])).toEqual({ fact: key })
    }
  })
})
