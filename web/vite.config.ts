import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

// Vite builds the SPA straight into the Go embed directory so `go build`
// picks it up via //go:embed. Paraglide compiles messages/*.json into typed
// message functions under src/lib/paraglide (generated, gitignored).
export default defineConfig({
  plugins: [
    svelte(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      // A choice made in the language menu wins; otherwise the browser's.
      strategy: ['localStorage', 'preferredLanguage', 'baseLocale'],
      localStorageKey: 'yundera-admin-locale',
    }),
  ],
  build: {
    outDir: '../internal/ui/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
})
