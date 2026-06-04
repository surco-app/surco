// Single source of truth for the fields a track must have filled before it can
// be converted. Lives in shared so the renderer's gate (lib/fields) and the
// persisted default settings (main/settings) reference the same list and can
// never drift apart.
export const DEFAULT_REQUIRED_FIELDS: string[] = ['title', 'artist']
