// The /casos-de-uso recipes name each setting by the label the app shows, and only the
// website's own languages carry recipes. Any other app language gets them through the app
// catalogues: an English label is traced back to its key (the Spanish recipe settles
// labels two keys share, the Settings components settle the rest) and read out in the
// target language.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const webDir = resolve(appDir, '../web')
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))

export const APP_LANGUAGES = ['es', 'en', 'de', 'fr', 'pt-BR', 'ja']
export const FIELDS = ['tab', 'section', 'setting', 'value']

function flat(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, `${prefix}${k}.`, out)
    else if (typeof v === 'string') out[`${prefix}${k}`] = v
  }
  return out
}

export const appLocale = (lang) =>
  json(join(appDir, `src/renderer/src/i18n/locales/${lang}.json`))
export const webLocale = (lang) => json(join(webDir, `src/i18n/locales/${lang}.json`))

const settingsDir = join(appDir, 'src/renderer/src/components/settings')
const settingsSource = readdirSync(settingsDir)
  .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
  .map((f) => readFileSync(join(settingsDir, f), 'utf8'))
  .join('\n')

export function recipeTranslator(lang) {
  const en = flat(appLocale('en'))
  const es = flat(appLocale('es'))
  const target = flat(appLocale(lang))
  return (field, enText, esText) => {
    let keys = Object.keys(en).filter((k) => en[k] === enText && es[k] === esText)
    if (field === 'tab') keys = keys.filter((k) => k.startsWith('settings.tabs.'))
    const used = keys.filter((k) => settingsSource.includes(`'${k}'`))
    if (used.length) keys = used
    const out = [...new Set(keys.map((k) => target[k]))]
    if (out.length !== 1)
      throw new Error(`${lang}: no single ${field} for "${enText}" (${keys.join(', ') || 'no key'})`)
    return out[0]
  }
}

export function recipeSettings(lang) {
  const en = webLocale('en').useCases.cases
  const es = webLocale('es').useCases.cases
  const translate = recipeTranslator(lang)
  return en.map((c) => {
    const esCase = es.find((o) => o.id === c.id)
    return {
      id: c.id,
      settings: c.settings.map((s, i) => {
        const out = { ...s }
        for (const f of FIELDS) if (s[f]) out[f] = translate(f, s[f], esCase.settings[i][f])
        return out
      }),
    }
  })
}
