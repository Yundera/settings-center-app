<script lang="ts">
  import Overview from './pages/Overview.svelte'
  import Health from './pages/Health.svelte'
  import Features from './pages/Features.svelte'
  import Support from './pages/Support.svelte'
  import Tools from './pages/Tools.svelte'
  import OnboardingGate from './onboarding/OnboardingGate.svelte'
  import Card from './lib/Card.svelte'
  import { api, type Me } from './lib/api'
  import { logout } from './lib/gate'
  import { errorText } from './lib/t'
  import { m } from './lib/paraglide/messages.js'
  import { getLocale, locales, setLocale } from './lib/paraglide/runtime.js'

  const pages = [
    { path: '/', label: () => m.nav_overview(), component: Overview },
    { path: '/health', label: () => m.nav_health(), component: Health },
    { path: '/features', label: () => m.nav_features(), component: Features },
    { path: '/support', label: () => m.nav_support(), component: Support },
    { path: '/tools', label: () => m.nav_tools(), component: Tools },
  ]

  // Every language this build ships, named in itself.
  const localeNames: Record<string, string> = { en: 'English', fr: 'Français', ko: '한국어' }

  let path = $state(location.pathname)
  const current = $derived(pages.find((p) => p.path === path) ?? pages[0])

  let me = $state<Me | null>(null)
  let meError = $state('')
  api
    .get<Me>('/api/me')
    .then((v) => (me = v))
    .catch((e) => (meError = errorText(e)))

  function go(e: MouseEvent, to: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    if (to !== path) history.pushState(null, '', to)
    path = to
    scrollTo(0, 0)
  }

  $effect(() => {
    const onPop = () => (path = location.pathname)
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  })

  $effect(() => {
    document.title = current.path === '/' ? 'Yundera' : `${current.label()} · Yundera`
  })
</script>

<div class="brandbar" aria-hidden="true"></div>
<header class="top">
  <div class="inner">
    <a class="brand" href="/" onclick={(e) => go(e, '/')}>
      <img src="/icon.svg" alt="" width="28" height="28" />
      <span>Yundera</span>
    </a>
    <nav aria-label={m.nav_label()}>
      {#each pages as p (p.path)}
        <a href={p.path} class:active={p.path === current.path} aria-current={p.path === current.path ? 'page' : undefined} onclick={(e) => go(e, p.path)}
          >{p.label()}</a
        >
      {/each}
    </nav>
    <div class="side">
      <select aria-label={m.language()} value={getLocale()} onchange={(e) => setLocale((e.currentTarget as HTMLSelectElement).value as (typeof locales)[number])}>
        {#each locales as l (l)}
          <option value={l}>{localeNames[l] ?? l}</option>
        {/each}
      </select>
      {#if me}
        <button class="link signout" title={me.user.email || me.user.id} onclick={() => logout(me!.upstreamLogoutUrl)}>{m.sign_out()}</button>
      {/if}
    </div>
  </div>
</header>

<main>
  {#if meError}
    <Card tone="bad"><p class="error">{meError}</p></Card>
  {:else if me && me.user.role !== 'admin'}
    <Card title={m.not_admin_title()}>
      <p>{m.not_admin_body({ name: me.user.fullName })}</p>
      <div class="row"><a class="button" href={me.links.maison}>{m.open_my_apps()}</a></div>
    </Card>
  {:else if me}
    <OnboardingGate />
    {#key current.path}
      <current.component {me} />
    {/key}
  {:else}
    <p class="muted">{m.loading()}</p>
  {/if}
</main>

<footer>
  <span>Yundera</span>
  {#if me}<span class="subtle">v{me.version}</span>{/if}
</footer>

<style>
  .brandbar {
    height: 3px;
    background: var(--brand-gradient);
  }
  .top {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .inner {
    max-width: 1100px;
    margin: 0 auto;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 1.25rem;
    height: 56px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-brand);
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--text);
    white-space: nowrap;
  }
  .brand:hover {
    text-decoration: none;
  }
  nav {
    display: flex;
    gap: 0.2rem;
    overflow-x: auto;
    flex: 1;
    scrollbar-width: none;
  }
  nav a {
    padding: 0.4rem 0.75rem;
    border-radius: 10px;
    color: var(--text-muted);
    white-space: nowrap;
    font-weight: 500;
  }
  nav a:hover {
    background: var(--surface-2);
    text-decoration: none;
  }
  nav a.active {
    background: var(--surface-3);
    color: var(--text);
    font-weight: 700;
  }
  .side {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .side select {
    padding: 0.25rem 0.4rem;
    font-size: 0.8rem;
  }
  .signout {
    white-space: nowrap;
    font-size: 0.85rem;
  }
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.5rem 16px 3rem;
  }
  footer {
    max-width: 1100px;
    margin: 0 auto;
    padding: 0 16px 2rem;
    display: flex;
    gap: 0.75rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    font-family: var(--font-brand);
  }
  @media (max-width: 720px) {
    .inner {
      flex-wrap: wrap;
      height: auto;
      padding-top: 0.5rem;
      gap: 0.5rem 1rem;
    }
    .side {
      margin-left: auto;
    }
    nav {
      order: 3;
      flex-basis: 100%;
      padding-bottom: 0.4rem;
    }
  }
</style>
