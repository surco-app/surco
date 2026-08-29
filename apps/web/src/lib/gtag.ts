// gtag.js only reads a queued item as a command when it looks like an `arguments`
// object: it checks for the "[object Arguments]" tag or an own `callee` property,
// and treats a plain array as a GTM-style push instead, silently dropping every
// config and event call. `callee` is what lets us keep a rest parameter.
export function asGtagArguments(args: unknown[]): unknown[] {
  return Object.assign(args, { callee: undefined })
}
