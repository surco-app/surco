import type { MbRecording, MbRecordingSearch, MbRelease, MbReleaseSearch } from './musicbrainz'

// Real MusicBrainz responses captured on 2026-09-28 for Kings of Tomorrow "Finally",
// trimmed to the fields the client reads: a recording search that excluded compilations,
// one compilation hit from the same search without the exclusion, a digital single with
// cover art and a double CD without it (two tracks kept per disc).
export const recordingSearch: MbRecordingSearch = {
  count: 61,
  recordings: [
    {
      id: '4d177afb-3995-4813-b378-927827b5752d',
      score: 90,
      title: 'Finally (Kosmic dub)',
      length: 491226,
      'artist-credit': [
        {
          name: 'Kings of Tomorrow',
        },
      ],
      releases: [
        {
          id: '07bb9a01-5887-40d4-b292-45d418de4fa6',
          title: 'It’s in the Lifestyle',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
            },
          ],
          'release-group': {
            'primary-type': 'Album',
          },
          date: '2009-06-02',
          country: 'XW',
          media: [
            {
              position: 2,
              format: 'Digital Media',
              'track-count': 8,
            },
          ],
        },
        {
          id: '9a1cb24a-171b-40b9-8218-1dfd014e0561',
          title: 'Finally',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
            },
          ],
          'release-group': {
            'primary-type': 'Single',
          },
          date: '2001',
          country: 'AU',
          media: [
            {
              position: 1,
              format: 'CD',
              'track-count': 6,
            },
          ],
        },
        {
          id: '87fabea0-0056-462d-ac7d-9ba3150d6028',
          title: 'It’s in the Lifestyle',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
            },
          ],
          'release-group': {
            'primary-type': 'Album',
          },
          date: '2001-04-23',
          country: 'XE',
          media: [
            {
              position: 2,
              format: 'CD',
              'track-count': 8,
            },
          ],
        },
      ],
    },
    {
      id: '1c7b2dfe-a779-4ef1-a1ed-d6e02cf91769',
      score: 87,
      title: 'Finally (Nuyorican Soul mix)',
      length: 494826,
      'artist-credit': [
        {
          name: 'Kings of Tomorrow',
        },
      ],
      releases: [
        {
          id: '0c4dbc1a-3dfa-46d2-ad25-03af27c70a90',
          title: 'Finally',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
            },
          ],
          'release-group': {
            'primary-type': 'Single',
          },
          date: '2016-05-27',
          country: 'XW',
          media: [
            {
              position: 1,
              format: 'Digital Media',
              'track-count': 3,
            },
          ],
        },
        {
          id: '07bb9a01-5887-40d4-b292-45d418de4fa6',
          title: 'It’s in the Lifestyle',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
            },
          ],
          'release-group': {
            'primary-type': 'Album',
          },
          date: '2009-06-02',
          country: 'XW',
          media: [
            {
              position: 2,
              format: 'Digital Media',
              'track-count': 8,
            },
          ],
        },
        {
          id: '9a1cb24a-171b-40b9-8218-1dfd014e0561',
          title: 'Finally',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
            },
          ],
          'release-group': {
            'primary-type': 'Single',
          },
          date: '2001',
          country: 'AU',
          media: [
            {
              position: 1,
              format: 'CD',
              'track-count': 6,
            },
          ],
        },
        {
          id: '87fabea0-0056-462d-ac7d-9ba3150d6028',
          title: 'It’s in the Lifestyle',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
            },
          ],
          'release-group': {
            'primary-type': 'Album',
          },
          date: '2001-04-23',
          country: 'XE',
          media: [
            {
              position: 2,
              format: 'CD',
              'track-count': 8,
            },
          ],
        },
      ],
    },
    {
      id: '0f34b2da-88d9-4dbc-b2ad-14d461ce371f',
      score: 82,
      title: 'Finally (Kevin Yost extended vocal mix)',
      length: 455506,
      'artist-credit': [
        {
          name: 'Kings of Tomorrow',
        },
      ],
      releases: [
        {
          id: '4a27f230-ab38-4fae-8dd7-c5032fd4a4ee',
          title: 'Finally (Includes Original & Kevin Yost Remixes)',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
              joinphrase: ' feat. ',
            },
            {
              name: 'Julie McKnight',
            },
          ],
          'release-group': {
            'primary-type': 'Single',
          },
          date: '2001-04-02',
          country: 'XW',
          media: [
            {
              position: 1,
              format: 'Digital Media',
              'track-count': 3,
            },
          ],
        },
        {
          id: '07bb9a01-5887-40d4-b292-45d418de4fa6',
          title: 'It’s in the Lifestyle',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
            },
          ],
          'release-group': {
            'primary-type': 'Album',
          },
          date: '2009-06-02',
          country: 'XW',
          media: [
            {
              position: 2,
              format: 'Digital Media',
              'track-count': 8,
            },
          ],
        },
        {
          id: 'b7dd461f-feba-4006-b976-724c7b7fb8a8',
          title: 'Finally',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
              joinphrase: ' feat. ',
            },
            {
              name: 'Julie McKnight',
            },
          ],
          'release-group': {
            'primary-type': 'Single',
          },
          date: '2001-04-30',
          country: 'FR',
          media: [
            {
              position: 1,
              format: '12" Vinyl',
              'track-count': 3,
            },
          ],
        },
        {
          id: '9a1cb24a-171b-40b9-8218-1dfd014e0561',
          title: 'Finally',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
            },
          ],
          'release-group': {
            'primary-type': 'Single',
          },
          date: '2001',
          country: 'AU',
          media: [
            {
              position: 1,
              format: 'CD',
              'track-count': 6,
            },
          ],
        },
        {
          id: '87fabea0-0056-462d-ac7d-9ba3150d6028',
          title: 'It’s in the Lifestyle',
          status: 'Official',
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
            },
          ],
          'release-group': {
            'primary-type': 'Album',
          },
          date: '2001-04-23',
          country: 'XE',
          media: [
            {
              position: 2,
              format: 'CD',
              'track-count': 8,
            },
          ],
        },
      ],
    },
  ],
}
export const compilationHits: MbRecording[] = [
  {
    id: '51a842ac-e045-4bf0-ab15-9f2e80c77042',
    score: 100,
    title: 'Finally',
    length: 187293,
    'artist-credit': [
      {
        name: 'Kings of Tomorrow',
      },
    ],
    releases: [
      {
        id: '541d1b89-793b-4a0c-9bee-6e752721b6e6',
        title: 'Ministry of Sound: The Annual 2002',
        status: 'Official',
        'artist-credit': [
          {
            name: 'Various Artists',
          },
        ],
        'release-group': {
          'primary-type': 'Album',
          'secondary-types': ['Compilation', 'DJ-mix'],
        },
        date: '2001-11-01',
        country: 'DE',
        media: [
          {
            position: 1,
            format: 'CD',
            'track-count': 16,
          },
        ],
      },
    ],
  },
]
export const finallySingle: MbRelease = {
  id: '4a27f230-ab38-4fae-8dd7-c5032fd4a4ee',
  title: 'Finally (Includes Original & Kevin Yost Remixes)',
  date: '2001-04-02',
  country: 'XW',
  'artist-credit': [
    {
      name: 'Kings of Tomorrow',
      joinphrase: ' feat. ',
    },
    {
      name: 'Julie McKnight',
      joinphrase: '',
    },
  ],
  'label-info': [
    {
      'catalog-number': null,
      label: {
        name: 'Distance',
      },
    },
  ],
  genres: [],
  'release-group': {
    'primary-type': 'Single',
    genres: [
      {
        name: 'deep house',
        count: 2,
      },
      {
        name: 'electronic',
        count: 2,
      },
      {
        name: 'house',
        count: 2,
      },
    ],
  },
  'cover-art-archive': {
    front: true,
  },
  media: [
    {
      position: 1,
      format: 'Digital Media',
      tracks: [
        {
          position: 1,
          number: '1',
          title: 'Finally',
          length: 334961,
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
              joinphrase: ' feat. ',
            },
            {
              name: 'Julie McKnight',
              joinphrase: '',
            },
          ],
        },
        {
          position: 2,
          number: '2',
          title: 'Finally (Yost Main Vocal extended remix)',
          length: 452427,
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
              joinphrase: ' feat. ',
            },
            {
              name: 'Julie McKnight',
              joinphrase: '',
            },
          ],
        },
        {
          position: 3,
          number: '3',
          title: 'Finally (Yost Dubified remix)',
          length: 216180,
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
              joinphrase: ' feat. ',
            },
            {
              name: 'Julie McKnight',
              joinphrase: '',
            },
          ],
        },
      ],
    },
  ],
}
export const lifestyleDoubleCd: MbRelease = {
  id: '87fabea0-0056-462d-ac7d-9ba3150d6028',
  title: 'It’s in the Lifestyle',
  date: '2001-04-23',
  country: 'XE',
  'artist-credit': [
    {
      name: 'Kings of Tomorrow',
      joinphrase: '',
    },
  ],
  'label-info': [
    {
      'catalog-number': 'Di 2022',
      label: {
        name: 'Distance',
      },
    },
  ],
  genres: [],
  'release-group': {
    'primary-type': 'Album',
    genres: [
      {
        name: 'deep house',
        count: 2,
      },
      {
        name: 'disco',
        count: 1,
      },
      {
        name: 'electronic',
        count: 2,
      },
      {
        name: 'house',
        count: 2,
      },
    ],
  },
  'cover-art-archive': {
    front: false,
  },
  media: [
    {
      position: 1,
      format: 'CD',
      tracks: [
        {
          position: 1,
          number: '1',
          title: 'KOT Anthem (Soul Vision remix)',
          length: 155000,
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
              joinphrase: '',
            },
          ],
        },
        {
          position: 2,
          number: '2',
          title: 'Tear It Up (original mix)',
          length: 315000,
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
              joinphrase: '',
            },
          ],
        },
      ],
    },
    {
      position: 2,
      format: 'CD',
      tracks: [
        {
          position: 1,
          number: '1',
          title: 'Finally (Dance Ritual mix)',
          length: 486093,
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
              joinphrase: '',
            },
          ],
        },
        {
          position: 2,
          number: '2',
          title: 'Finally (Nuyorican Soul mix)',
          length: 494826,
          'artist-credit': [
            {
              name: 'Kings of Tomorrow',
              joinphrase: '',
            },
          ],
        },
      ],
    },
  ],
}

// The same artist's album looked up by release title and artist on /ws/2/release, the
// "Search by album first" query (first three of six releases kept).
export const albumReleaseSearch: MbReleaseSearch = {
  count: 6,
  releases: [
    {
      id: '2e84bec2-c062-411f-bec2-c0aefc0073b2',
      title: 'It’s in the Lifestyle',
      status: 'Official',
      'artist-credit': [
        {
          name: 'Kings of Tomorrow',
        },
      ],
      'release-group': {
        'primary-type': 'Album',
      },
      date: '2000-06-12',
      country: 'FR',
      media: [
        {
          format: 'CD',
          'track-count': 13,
        },
      ],
    },
    {
      id: '87fabea0-0056-462d-ac7d-9ba3150d6028',
      title: 'It’s in the Lifestyle',
      status: 'Official',
      'artist-credit': [
        {
          name: 'Kings of Tomorrow',
        },
      ],
      'release-group': {
        'primary-type': 'Album',
      },
      date: '2001-04-23',
      country: 'XE',
      media: [
        {
          format: 'CD',
          'track-count': 13,
        },
        {
          format: 'CD',
          'track-count': 8,
        },
      ],
    },
    {
      id: '64ceaf0c-4c94-4811-a01c-bbf066172f0e',
      title: 'It’s in the Lifestyle',
      status: 'Official',
      'artist-credit': [
        {
          name: 'Kings of Tomorrow',
        },
      ],
      'release-group': {
        'primary-type': 'Album',
      },
      date: '2007-10-19',
      country: 'XW',
      media: [
        {
          format: 'Digital Media',
          'track-count': 13,
        },
      ],
    },
  ],
}
