<script lang="ts">
  import Card from '../lib/Card.svelte'
  import Dialog from '../lib/Dialog.svelte'
  import Explain from '../lib/Explain.svelte'
  import LevelPill from '../lib/LevelPill.svelte'
  import Pill from '../lib/Pill.svelte'
  import { api, type Me, type Overview, type TileName } from '../lib/api'
  import { navigate } from '../lib/nav'
  import { errorText, statusText } from '../lib/t'
  import { m } from '../lib/paraglide/messages.js'

  let { me }: { me: Me } = $props()

  let data = $state<Overview | null>(null)
  let error = $state('')

  async function load() {
    try {
      data = await api.get<Overview>('/api/overview')
      error = ''
    } catch (e) {
      error = errorText(e)
    }
  }

  $effect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  })

  const headline = $derived(
    !data
      ? ''
      : data.summary.level === 'bad'
        ? m.overview_headline_bad()
        : data.summary.level === 'warn'
          ? m.overview_headline_warn()
          : data.summary.level === 'unknown'
            ? m.overview_headline_unknown()
            : m.overview_headline_ok(),
  )

  const tiles: { name: TileName; title: () => string; page: string }[] = [
    { name: 'healthCheck', title: () => m.tile_health(), page: '/health' },
    { name: 'updates', title: () => m.tile_updates(), page: '/features' },
    { name: 'connection', title: () => m.tile_connection(), page: '/support' },
    { name: 'storage', title: () => m.tile_storage(), page: '/tools' },
    { name: 'support', title: () => m.tile_support(), page: '/support' },
  ]

  const storagePercent = $derived(Number(data?.summary.tiles.storage.params?.percent ?? NaN))

  // ---- restart -----------------------------------------------------------
  let confirmReboot = $state(false)
  let rebooting = $state(false)
  let rebootError = $state('')
  let back = $state(false)

  async function reboot() {
    rebootError = ''
    try {
      await api.post('/api/reboot')
      confirmReboot = false
      rebooting = true
      waitForReturn()
    } catch (e) {
      rebootError = errorText(e)
    }
  }

  // The server answers again once it is back: watch the public health route
  // go away and come back, then reload.
  async function waitForReturn() {
    let wentDown = false
    const started = Date.now()
    while (Date.now() - started < 15 * 60_000) {
      await new Promise((r) => setTimeout(r, 5000))
      try {
        const res = await fetch('/api/health', { cache: 'no-store' })
        if (res.ok && wentDown) {
          back = true
          setTimeout(() => location.reload(), 1500)
          return
        }
        if (!res.ok) wentDown = true
      } catch {
        wentDown = true
      }
    }
  }
</script>

<div class="page-intro">
  <h1>{m.overview_title()}</h1>
  <p>{m.overview_intro()}</p>
</div>

{#if error && !data}
  <Card tone="bad"><p class="error">{error}</p></Card>
{:else if !data}
  <p class="muted">{m.loading()}</p>
{:else}
  <div class="stack">
    <Card tone={data.summary.level}>
      <div class="hero">
        <div class="who">
          <a class="domain" href={data.links.root} target="_blank" rel="noopener">{data.domain}</a>
          <div class="muted ip">
            {m.overview_public_ip({ ip: data.publicIp || '—' })}
            <Explain>{m.explain_public_ip()}</Explain>
          </div>
        </div>
        <div class="verdict">
          <span class="dot {data.summary.level}" aria-hidden="true"></span>
          <strong>{headline}</strong>
          {#if data.running}<Pill tone="info">{m.overview_check_running()}</Pill>{/if}
        </div>
        <div class="row actions">
          <a class="button primary" href={data.links.maison}>{m.open_my_apps()}</a>
          <a class="button" href={data.links.dashboard} target="_blank" rel="noopener">{m.open_subscription()}</a>
        </div>
      </div>
    </Card>

    {#if data.summary.issues.length}
      <Card title={m.overview_attention()}>
        <ul class="issues">
          {#each data.summary.issues as issue (issue.code)}
            <li>
              <LevelPill level={issue.level} />
              <span>{statusText('issue.' + issue.code, issue.params)}</span>
              <a href={issue.page} onclick={(e) => navigate(e, issue.page)}>{m.overview_fix()}</a>
            </li>
          {/each}
        </ul>
      </Card>
    {/if}

    <div class="tiles">
      {#each tiles as t (t.name)}
        {@const tile = data.summary.tiles[t.name]}
        <a class="tile {tile.level}" href={t.page} onclick={(e) => navigate(e, t.page)}>
          <div class="tile-head">
            <span class="tile-title">{t.title()}</span>
            <LevelPill level={tile.level} />
          </div>
          <p>{statusText(tile.code, tile.params)}</p>
          {#if t.name === 'storage' && Number.isFinite(storagePercent)}
            <div class="bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={storagePercent} aria-label={t.title()}>
              <span style="width: {Math.min(100, storagePercent)}%"></span>
            </div>
          {/if}
        </a>
      {/each}
    </div>

    <h2 class="section-title">{m.overview_shortcuts()}</h2>
    <div class="shortcuts">
      <a class="shortcut" href={data.links.maison}>
        <strong>{m.tools_maison_title()}</strong><span class="muted">{m.tools_maison_short()}</span>
      </a>
      <a class="shortcut" href={data.links.maisonBackups}>
        <strong>{m.tools_backups_title()}</strong><span class="muted">{m.tools_backups_short()}</span>
      </a>
      <a class="shortcut" href={data.links.authConsole}>
        <strong>{m.tools_accounts_title()}</strong><span class="muted">{m.tools_accounts_short()}</span>
      </a>
      <a class="shortcut" href={data.links.meshConsole}>
        <strong>{m.tools_network_title()}</strong><span class="muted">{m.tools_network_short()}</span>
      </a>
      <a class="shortcut more" href="/tools" onclick={(e) => navigate(e, '/tools')}>
        <strong>{m.overview_all_tools()}</strong><span class="muted">{m.overview_all_tools_hint()}</span>
      </a>
    </div>

    <h2 class="section-title">{m.overview_server()}</h2>
    <Card title={m.reboot_title()}>
      <p class="muted">{m.reboot_intro()}</p>
      {#if rebooting}
        <p><Pill tone={back ? 'ok' : 'info'}>{back ? m.reboot_back() : m.reboot_waiting()}</Pill></p>
      {:else}
        <div class="row"><button onclick={() => (confirmReboot = true)}>{m.reboot_button()}</button></div>
      {/if}
    </Card>
  </div>
{/if}

<Dialog open={confirmReboot} title={m.reboot_confirm_title()} onclose={() => (confirmReboot = false)}>
  <p>{m.reboot_confirm_body()}</p>
  <p class="muted">{m.reboot_confirm_safe()}</p>
  {#if rebootError}<p class="error">{rebootError}</p>{/if}
  {#snippet actions()}
    <button onclick={() => (confirmReboot = false)}>{m.cancel()}</button>
    <button class="primary" onclick={reboot}>{m.reboot_confirm_button()}</button>
  {/snippet}
</Dialog>

<style>
  .hero {
    display: grid;
    gap: 0.75rem;
  }
  .domain {
    font-family: var(--font-brand);
    font-size: 1.35rem;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .ip {
    margin-top: 0.15rem;
  }
  .verdict {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 1.05rem;
  }
  .dot {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    background: var(--border-strong);
    flex: none;
  }
  .dot.ok {
    background: var(--ok-fg);
  }
  .dot.warn {
    background: var(--warn-fg);
  }
  .dot.bad {
    background: var(--bad-fg);
  }
  .issues {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .issues li {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .issues li span:not(:first-child) {
    flex: 1;
    min-width: 12rem;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.75rem;
  }
  .tile {
    display: grid;
    align-content: start;
    gap: 0.4rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-top: 3px solid var(--border-strong);
    border-radius: var(--radius-card);
    padding: 0.85rem 1rem;
    color: var(--text);
    box-shadow: var(--shadow-card);
  }
  .tile:hover {
    text-decoration: none;
    border-color: var(--primary);
  }
  .tile.ok {
    border-top-color: var(--ok-fg);
  }
  .tile.warn {
    border-top-color: var(--warn-fg);
  }
  .tile.bad {
    border-top-color: var(--bad-fg);
  }
  .tile.info {
    border-top-color: var(--info-fg);
  }
  .tile-head {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: center;
  }
  .tile-title {
    font-family: var(--font-brand);
    font-weight: 700;
  }
  .tile p {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .bar {
    height: 0.45rem;
    border-radius: 999px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--primary);
  }
  .tile.warn .bar span {
    background: var(--warn-fg);
  }
  .tile.bad .bar span {
    background: var(--bad-fg);
  }
  .shortcuts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 0.6rem;
  }
  .shortcut {
    display: grid;
    gap: 0.15rem;
    padding: 0.75rem 0.9rem;
    border-radius: var(--radius-card);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 0.85rem;
  }
  .shortcut strong {
    font-family: var(--font-brand);
  }
  .shortcut:hover {
    border-color: var(--primary);
    text-decoration: none;
  }
  .shortcut.more {
    background: var(--primary-soft);
    border-style: dashed;
  }
</style>
