// The package ships real typings at its root but its package.json "exports" map does not
// list them, so under moduleResolution "Bundler" TypeScript resolves the runtime entry
// and reports an implicit any. It is a drop-in fork of better-sqlite3 plus the cipher
// pragmas, and those pragmas go through `pragma()` like any other, so the upstream types
// describe this package exactly.
declare module 'better-sqlite3-multiple-ciphers' {
  import Database from 'better-sqlite3'
  export = Database
}
