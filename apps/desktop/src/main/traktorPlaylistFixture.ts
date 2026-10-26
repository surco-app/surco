// A collection.nml with the playlist shapes the tree editor meets: twin folders, a
// playlist repeating a row, a smartlist and an escaped name.
export const playlistRow = (key: string) =>
  `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${key}"></PRIMARYKEY>\n</ENTRY>`

export const PLAYLISTS_SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="20"><COLLECTION ENTRIES="0"></COLLECTION>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="4">
<NODE TYPE="PLAYLIST" NAME="Preparation"><PLAYLIST ENTRIES="0" TYPE="LIST" UUID="prep"></PLAYLIST>
</NODE>
<NODE TYPE="FOLDER" NAME="Sets"><SUBNODES COUNT="2">
<NODE TYPE="PLAYLIST" NAME="Friday"><PLAYLIST ENTRIES="3" TYPE="LIST" UUID="fri">
${playlistRow('HD/:m/:a.mp3')}
${playlistRow('HD/:m/:sep.mp3')}
${playlistRow('HD/:m/:a.mp3')}
</PLAYLIST>
</NODE>
<NODE TYPE="SMARTLIST" NAME="Top"><SMARTLIST UUID="s1"><SEARCH_EXPRESSION VERSION="1" QUERY="$RATING &gt; 3"></SEARCH_EXPRESSION>
</SMARTLIST>
</NODE>
</SUBNODES>
</NODE>
<NODE TYPE="FOLDER" NAME="Sets"><SUBNODES COUNT="1">
<NODE TYPE="FOLDER" NAME="Old"><SUBNODES COUNT="0"></SUBNODES>
</NODE>
</SUBNODES>
</NODE>
<NODE TYPE="PLAYLIST" NAME="Drum &amp; Bass"><PLAYLIST ENTRIES="0" TYPE="LIST" UUID="dnb"></PLAYLIST>
</NODE>
</SUBNODES>
</NODE>
</PLAYLISTS>
<INDEXING></INDEXING>
</NML>
`
