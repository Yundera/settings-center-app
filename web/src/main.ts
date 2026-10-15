import '@fontsource/comfortaa/latin-400.css'
import '@fontsource/comfortaa/latin-700.css'
import './styles/tokens.css'
import './styles/app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { forwardLegacyHash } from './lib/legacyHash'
import { getLocale } from './lib/paraglide/runtime.js'

document.documentElement.lang = getLocale()

// Old #/… links (support deeplinks, bookmarks) first; some leave this app.
if (!forwardLegacyHash()) {
  mount(App, { target: document.getElementById('app')! })
}
