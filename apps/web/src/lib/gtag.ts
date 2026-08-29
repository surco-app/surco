// gtag.js drains the dataLayer queue by dispatching only items that are real
// `arguments` objects; it treats a plain array as a GTM-style push and drops the
// config and event calls without any error. Marking an array with a `callee`
// property is not enough either: verified against the live site, only a genuine
// `arguments` object produces a /g/collect hit. Hence the official snippet's
// shape, kept verbatim here.
export function toGtagArguments(..._args: unknown[]): IArguments {
  // biome-ignore lint/complexity/noArguments: gtag.js only dispatches real `arguments`
  return arguments
}
