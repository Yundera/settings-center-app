// Every locale must carry exactly the base locale's keys, with the same
// {placeholders}. Paraglide falls back to English for a missing key at
// runtime, which would silently mix languages on a page; this makes it a
// build failure instead. Adding a language (ko) = one more messages/<locale>.json.
import { readFileSync } from 'node:fs'

const settings = JSON.parse(readFileSync(new URL('../project.inlang/settings.json', import.meta.url)))
const load = (l) => JSON.parse(readFileSync(new URL(`../messages/${l}.json`, import.meta.url)))
const params = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

const base = load(settings.baseLocale)
let bad = 0
for (const locale of settings.locales.filter((l) => l !== settings.baseLocale)) {
  const msgs = load(locale)
  for (const k of Object.keys(base)) {
    if (k.startsWith('$')) continue
    if (!(k in msgs)) { console.error(`${locale}: missing "${k}"`); bad++; continue }
    if (params(base[k]) !== params(msgs[k])) { console.error(`${locale}: "${k}" placeholders differ`); bad++ }
  }
  for (const k of Object.keys(msgs)) if (!(k in base)) { console.error(`${locale}: unknown key "${k}"`); bad++ }
}
if (bad) { console.error(`${bad} message problem(s)`); process.exit(1) }
console.log(`messages ok: ${Object.keys(base).length - 1} keys × ${settings.locales.length} locales`)
