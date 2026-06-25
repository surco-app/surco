import { describe, expect, it } from 'vitest'
import { imageUrlsFromDrag } from './dragImages'

// Minimal DataTransfer stub: only getData matters here, backed by a per-type map so each
// test states exactly what the browser put on the drag.
function dt(data: Record<string, string>): DataTransfer {
  return { getData: (t: string) => data[t] ?? '' } as unknown as DataTransfer
}

describe('imageUrlsFromDrag', () => {
  it('returns the image URL a browser put on text/uri-list', () => {
    expect(imageUrlsFromDrag(dt({ 'text/uri-list': 'https://img.example/cover.jpg' }))).toEqual([
      'https://img.example/cover.jpg',
    ])
  })

  // uri-list is a multi-line format whose comment lines start with '#'; those are metadata,
  // not URLs, so they must never reach main as a candidate cover.
  it('skips comment lines in a multi-line uri-list', () => {
    const list = '# dragged from example.com\nhttps://img.example/a.png\n'
    expect(imageUrlsFromDrag(dt({ 'text/uri-list': list }))).toEqual(['https://img.example/a.png'])
  })

  // When a page drops an <img> tag rather than a clean URL, we recover the src so the drag
  // still yields a usable cover.
  it('extracts the src from an <img> tag in text/html', () => {
    const html = '<meta><img alt="cover" src="https://img.example/from-html.jpg" />'
    expect(imageUrlsFromDrag(dt({ 'text/html': html }))).toEqual([
      'https://img.example/from-html.jpg',
    ])
  })

  it('accepts a data:image URL from plain text', () => {
    expect(imageUrlsFromDrag(dt({ 'text/plain': 'data:image/png;base64,AAAA' }))).toEqual([
      'data:image/png;base64,AAAA',
    ])
  })

  // We can't tell an image URL from a page URL by its text alone, so any http(s) candidate
  // is returned and main decides by actually fetching it. What we DO reject up front is a
  // string that isn't an http(s)/data:image URL at all (e.g. a mailto: or a bare word).
  it('drops strings that are not http(s)/data:image URLs', () => {
    expect(imageUrlsFromDrag(dt({ 'text/plain': 'mailto:someone@example.com' }))).toEqual([])
    expect(imageUrlsFromDrag(dt({ 'text/uri-list': 'just some dragged text' }))).toEqual([])
  })

  // A link dragged from a page reads as a valid http(s) URL, so it is passed through; main
  // is what discovers it resolves to no image and leaves the artwork untouched.
  it('passes through an http(s) URL even when it points at a page, not an image', () => {
    expect(imageUrlsFromDrag(dt({ 'text/uri-list': 'https://a-page.example/article' }))).toEqual([
      'https://a-page.example/article',
    ])
  })

  // The same URL often arrives on more than one type (uri-list AND plain text). main tries
  // each candidate in turn, so duplicates would just be wasted fetches — dedupe them.
  it('dedupes a URL that arrives on several types', () => {
    const url = 'https://img.example/cover.jpg'
    expect(
      imageUrlsFromDrag(dt({ 'text/uri-list': url, 'text/plain': url })),
    ).toEqual([url])
  })

  it('returns an empty list when the drag carried no image', () => {
    expect(imageUrlsFromDrag(dt({}))).toEqual([])
  })
})
