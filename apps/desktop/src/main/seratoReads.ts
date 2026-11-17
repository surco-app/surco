import {
  readSeratoLibrary,
  type SeratoLibraryRoot,
  seratoCollection,
  seratoMembership,
  seratoPlaylist,
  seratoRecentCount,
  seratoTrackCount,
  seratoTree,
} from './seratoLibrary'

type Library = ReturnType<typeof readSeratoLibrary>

const READS = {
  tree: (library: Library, _arg: undefined) => seratoTree(library),
  recentCount: (library: Library, _arg: undefined) => seratoRecentCount(library),
  trackCount: (library: Library, _arg: undefined) => seratoTrackCount(library),
  collection: (library: Library, _arg: undefined) => seratoCollection(library),
  playlist: (library: Library, id: string) => seratoPlaylist(library, id),
  membership: (library: Library, paths: string[]) => seratoMembership(library, paths),
}

export type SeratoReadName = keyof typeof READS
export type SeratoReadArg<N extends SeratoReadName> = Parameters<(typeof READS)[N]>[1]
export type SeratoReadAnswer<N extends SeratoReadName> = ReturnType<(typeof READS)[N]>

export function runSeratoRead<N extends SeratoReadName>(
  roots: SeratoLibraryRoot[],
  name: N,
  arg: SeratoReadArg<N>,
): SeratoReadAnswer<N> {
  const run = READS[name] as (library: Library, arg: SeratoReadArg<N>) => SeratoReadAnswer<N>
  return run(readSeratoLibrary(roots), arg)
}
