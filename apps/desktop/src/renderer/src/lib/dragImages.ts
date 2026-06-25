// Pulls the candidate image URLs out of a drag that carried no file — i.e. an <img>
// dragged from a web page. Browsers expose them as text/uri-list (often the clean image
// URL, but sometimes the link the image sat inside — a page, not a picture), an <img>
// tag in text/html, or plain text. We return every http(s)/data: image URL we find, in
// that order, so main can try each and keep the first that is actually an image.
export function imageUrlsFromDrag(dt: DataTransfer): string[] {
  const isImageUrl = (s: string): boolean => /^https?:\/\//i.test(s) || /^data:image\//i.test(s)
  const urls: string[] = []
  for (const line of dt.getData('text/uri-list').split('\n')) {
    const l = line.trim()
    if (l && !l.startsWith('#') && isImageUrl(l)) urls.push(l)
  }
  const fromHtml = dt.getData('text/html').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
  if (fromHtml && isImageUrl(fromHtml)) urls.push(fromHtml)
  const plain = dt.getData('text/plain').trim()
  if (isImageUrl(plain)) urls.push(plain)
  return [...new Set(urls)]
}
