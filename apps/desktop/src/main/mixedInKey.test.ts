import { describe, expect, it } from 'vitest'
import { mixedInKeyCuesToTraktorTree, parseMixedInKeyCues } from './mixedInKey'
import { readTraktorMarkers } from './traktor4'

// Verbatim from djotas' "Chab And Jd Davis - Get High", base64-decoded out of the file's
// GEOB "CuePoints" object — the exact shape Mixed In Key writes, sub-millisecond floats
// and repeated names included.
const REAL_JSON =
  '{"algorithm":14,"cues":[{"name":"Energy 6","time":156.45815233710408},' +
  '{"name":"Energy 6","time":61108.946135565486},' +
  '{"name":"Energy 7","time":289680.77607267193}],"source":"mixedinkey"}'

describe('parseMixedInKeyCues', () => {
  it('reads the cues a Mixed In Key file stores', () => {
    const cues = parseMixedInKeyCues(REAL_JSON)
    expect(cues).toEqual([
      { name: 'Energy 6', startMs: 156.45815233710408 },
      { name: 'Energy 6', startMs: 61108.946135565486 },
      { name: 'Energy 7', startMs: 289680.77607267193 },
    ])
  })

  // Anything that is not Mixed In Key's own payload must come back empty rather than
  // half-parsed: the caller writes whatever it gets into Traktor's cue field, so a
  // partial read would ship a broken tree instead of simply carrying no cues.
  it('returns nothing for another tool payload', () => {
    expect(parseMixedInKeyCues('{"key":"11A","source":"other"}')).toEqual([])
    expect(parseMixedInKeyCues('not json at all')).toEqual([])
  })
})

describe('mixedInKeyCuesToTraktorTree', () => {
  // The point of the whole translation: what comes out has to be a tree Traktor's own
  // parser reads back, at the same positions, or the FLAC carries a blob Traktor ignores.
  it('builds a tree whose markers Traktor reads back at the same positions', () => {
    const tree = mixedInKeyCuesToTraktorTree(parseMixedInKeyCues(REAL_JSON))
    expect(tree).not.toBeNull()

    const markers = readTraktorMarkers(tree as Uint8Array)
    expect(markers).toHaveLength(3)
    // Traktor stores whole milliseconds; Mixed In Key's sub-millisecond precision is
    // beyond anything audible and beyond what the format holds.
    expect(markers.map((m) => Math.round(m.startMs))).toEqual([156, 61109, 289681])
  })

  it('carries the cue names through', () => {
    const tree = mixedInKeyCuesToTraktorTree(parseMixedInKeyCues(REAL_JSON))
    expect(readTraktorMarkers(tree as Uint8Array).map((m) => m.name)).toEqual([
      'Energy 6',
      'Energy 6',
      'Energy 7',
    ])
  })

  // No cues means no tree at all: writing an empty CUEP would replace whatever the FLAC
  // already had with a valid-but-empty blob, which reads to Traktor as "this track has
  // been analysed and has no cues" rather than "nothing was carried over".
  it('returns null when there is nothing to carry', () => {
    expect(mixedInKeyCuesToTraktorTree([])).toBeNull()
  })
})
