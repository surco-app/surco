import { Search } from 'lucide-react'
import { expect, it } from 'vitest'
import { SETTINGS_TAB_ICONS } from './settingsTabs'

it('draws the Sources tab with an icon of its own, since the settings search field right above it already shows the magnifier', () => {
  expect(SETTINGS_TAB_ICONS.search).not.toBe(Search)
})
