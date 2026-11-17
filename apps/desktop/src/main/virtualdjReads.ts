import {
  readVirtualdjLibrary,
  type VirtualdjRoot,
  virtualdjCollection,
  virtualdjMembership,
  virtualdjPlaylist,
  virtualdjRecentCount,
  virtualdjTrackCount,
  virtualdjTree,
} from './virtualdjLibrary'

type Library = ReturnType<typeof readVirtualdjLibrary>

const READS = {
  tree: (library: Library, _arg: undefined) => virtualdjTree(library),
  recentCount: (library: Library, _arg: undefined) => virtualdjRecentCount(library),
  trackCount: (library: Library, _arg: undefined) => virtualdjTrackCount(library),
  collection: (library: Library, _arg: undefined) => virtualdjCollection(library),
  playlist: (library: Library, id: string) => virtualdjPlaylist(library, id),
  membership: (library: Library, paths: string[]) => virtualdjMembership(library, paths),
}

export type VirtualdjReadName = keyof typeof READS
export type VirtualdjReadArg<N extends VirtualdjReadName> = Parameters<(typeof READS)[N]>[1]
export type VirtualdjReadAnswer<N extends VirtualdjReadName> = ReturnType<(typeof READS)[N]>

export function runVirtualdjRead<N extends VirtualdjReadName>(
  roots: VirtualdjRoot[],
  name: N,
  arg: VirtualdjReadArg<N>,
): VirtualdjReadAnswer<N> {
  const run = READS[name] as (library: Library, arg: VirtualdjReadArg<N>) => VirtualdjReadAnswer<N>
  return run(readVirtualdjLibrary(roots), arg)
}
