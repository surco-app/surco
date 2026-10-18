import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script shared with node, no declaration file
import { parseUpstream } from '../../../../scripts/bakenUpstream.mjs'

describe('parseUpstream', () => {
  // A Windows checkout may turn the file into CRLF; a tag that keeps its '\r' makes
  // `git clone --branch` fail on the release runner only.
  it('reads url, tag and commit from an LF file', () => {
    expect(parseUpstream('https://example.test/baken\nv4.6.1\nabc123\n')).toEqual([
      'https://example.test/baken',
      'v4.6.1',
      'abc123',
    ])
  })

  it('drops the carriage returns of a CRLF checkout', () => {
    expect(parseUpstream('https://example.test/baken\r\nv4.6.1\r\nabc123\r\n')).toEqual([
      'https://example.test/baken',
      'v4.6.1',
      'abc123',
    ])
  })
})
