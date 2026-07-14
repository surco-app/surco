import { describe, expect, it } from 'vitest'
import { escapeXml } from './xml'

describe('escapeXml', () => {
  // Both DJ exports write XML the target app parses strictly: an unescaped & or < in a
  // tag makes rekordbox and Traktor drop the track (or refuse the file). The escaping
  // lived copy-pasted in each exporter, which is how a fix to one silently leaves the
  // bug in the other — the reason it is one function now.
  it('escapes every character that would break an XML document', () => {
    expect(escapeXml(`Rock & Roll <b> "quoted" 'single'`)).toBe(
      'Rock &amp; Roll &lt;b&gt; &quot;quoted&quot; &apos;single&apos;',
    )
  })

  // The ampersand must go FIRST: escaping < to &lt; before & would then rewrite that
  // new ampersand into &amp;lt;, double-escaping the output.
  it('escapes the ampersand before the entities it introduces', () => {
    expect(escapeXml('<')).toBe('&lt;')
    expect(escapeXml('&lt;')).toBe('&amp;lt;')
  })

  it('leaves text with nothing to escape untouched', () => {
    expect(escapeXml('Strobe (Original Mix)')).toBe('Strobe (Original Mix)')
    expect(escapeXml('')).toBe('')
  })
})
