// Whether the configs are not all the same. Compared by content, key by key, because each
// track carries its own copy of the setting it was staged with: two copies of the same dial
// are the same setting, and only a real difference should make the editor stop speaking for
// the whole selection as one.
export function configsDiffer<T extends object | undefined>(configs: readonly T[]): boolean {
  const canon = (c: T): string =>
    JSON.stringify(
      Object.entries(c ?? {})
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    )
  return configs.some((c) => canon(c) !== canon(configs[0]))
}
