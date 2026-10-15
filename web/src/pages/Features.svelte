<script lang="ts">
  import Card from '../lib/Card.svelte'
  import Dialog from '../lib/Dialog.svelte'
  import Explain from '../lib/Explain.svelte'
  import Pill from '../lib/Pill.svelte'
  import Switch from '../lib/Switch.svelte'
  import { api, type ChannelId, type Feature, type FeatureId, type Me, type OnboardingStatus, type UpdateChannel } from '../lib/api'
  import { errorText } from '../lib/t'
  import { m } from '../lib/paraglide/messages.js'

  let { me }: { me: Me } = $props()

  // ---- switchable features -------------------------------------------------

  interface Descriptor {
    id: FeatureId
    title: () => string
    what: () => string
    cost: () => string
    confirm?: { question: () => string; warning: () => string }
  }

  const live: Descriptor[] = [
    {
      id: 'yundera-login',
      title: () => m.feature_login_title(),
      what: () => m.feature_login_what(),
      cost: () => m.feature_login_cost(),
      confirm: { question: () => m.feature_login_confirm(), warning: () => m.feature_login_warning() },
    },
    {
      id: 'support-key',
      title: () => m.feature_support_title(),
      what: () => m.feature_support_what(),
      cost: () => m.feature_support_cost(),
      confirm: { question: () => m.feature_support_confirm(), warning: () => m.feature_support_warning() },
    },
    {
      id: 'platform-updates',
      title: () => m.feature_updates_title(),
      what: () => m.feature_updates_what(),
      cost: () => m.feature_updates_cost(),
    },
  ]

  const fixed = [
    { title: () => m.feature_domain_title(), what: () => m.feature_domain_what(), cost: () => m.feature_domain_cost() },
    { title: () => m.feature_mail_title(), what: () => m.feature_mail_what(), cost: () => m.feature_mail_cost() },
    { title: () => m.feature_sslip_title(), what: () => m.feature_sslip_what(), cost: () => m.feature_sslip_cost() },
    { title: () => m.feature_appupdates_title(), what: () => m.feature_appupdates_what(), cost: () => m.feature_appupdates_cost(), notYet: true },
  ]

  let states = $state<Record<string, Feature>>({})
  let onboarding = $state<OnboardingStatus | null>(null)
  let loadError = $state('')
  let busy = $state<FeatureId | null>(null)
  let rowError = $state<Record<string, string>>({})
  let confirming = $state<Descriptor | null>(null)

  async function load() {
    try {
      const [f, o] = await Promise.all([
        api.get<{ features: Feature[] }>('/api/features'),
        api.get<OnboardingStatus>('/api/onboarding/status'),
      ])
      states = Object.fromEntries(f.features.map((x) => [x.id, x]))
      onboarding = o
      loadError = ''
    } catch (e) {
      loadError = errorText(e)
    }
  }
  load()

  // Say why a switch is locked before the click, not after it.
  function blocked(id: FeatureId): string | null {
    if (!onboarding || onboarding.claimed) return null
    if (id === 'yundera-login' && states[id]?.enabled) return m.feature_guard_login()
    if (id === 'support-key' && states[id]?.enabled && states['yundera-login']?.enabled === false) return m.feature_guard_support()
    return null
  }

  function toggle(d: Descriptor, next: boolean) {
    if (!next && d.confirm) {
      confirming = d
      return
    }
    apply(d.id, next)
  }

  async function apply(id: FeatureId, enabled: boolean) {
    confirming = null
    busy = id
    rowError = { ...rowError, [id]: '' }
    try {
      states = { ...states, [id]: await api.post<Feature>('/api/features', { id, enabled }) }
    } catch (e) {
      rowError = { ...rowError, [id]: errorText(e) }
    } finally {
      busy = null
    }
  }

  // ---- update channel -----------------------------------------------------

  const MAIN_URL = 'https://github.com/Yundera/template-root/archive/refs/heads/main.zip'
  let channel = $state<UpdateChannel | null>(null)
  let picked = $state<ChannelId>('stable')
  let customUrl = $state('')
  let channelMsg = $state('')
  let channelErr = $state('')
  api
    .get<UpdateChannel>('/api/update-channel')
    .then((c) => {
      channel = c
      picked = c.channel === 'frozen' ? 'stable' : c.channel
      if (c.channel === 'custom') customUrl = c.updateUrl
    })
    .catch((e) => (channelErr = errorText(e)))

  async function saveChannel() {
    channelMsg = channelErr = ''
    const updateUrl = picked === 'stable' ? '' : picked === 'main' ? MAIN_URL : picked === 'local' ? 'local' : customUrl.trim()
    try {
      channel = await api.post<UpdateChannel>('/api/update-channel', { updateUrl })
      channelMsg = m.channel_saved()
    } catch (e) {
      channelErr = errorText(e)
    }
  }

  // ---- re-run onboarding ------------------------------------------------------

  let resetOpen = $state(false)
  let resetWord = $state('')
  let resetBusy = $state(false)
  let resetErr = $state('')
  let resetDone = $state<{ backup: string; warning?: string } | null>(null)

  async function reset() {
    resetBusy = true
    resetErr = ''
    try {
      resetDone = await api.post<{ backup: string; warning?: string }>('/api/onboarding/reset', { confirm: true })
      resetOpen = false
    } catch (e) {
      resetErr = errorText(e)
    } finally {
      resetBusy = false
    }
  }
</script>

<div class="page-intro">
  <h1>{m.features_title()}</h1>
  <p>{m.features_intro()}</p>
</div>

{#if loadError}<Card tone="bad"><p class="error">{loadError}</p></Card>{/if}

<div class="stack">
  {#each live as d (d.id)}
    {@const st = states[d.id]}
    {@const why = blocked(d.id)}
    <Card>
      <div class="feature">
        <div class="text">
          <div class="row">
            <h2>{d.title()}</h2>
            {#if st?.enabled === true}<Pill tone="ok">{m.feature_on()}</Pill>{:else if st?.enabled === false}<Pill tone="warn">{m.feature_off()}</Pill>{/if}
          </div>
          <p>{d.what()}</p>
          <p class="muted">{d.cost()}</p>
          {#if why}<p class="note">{why} <a href={me.links.authConsole}>{m.feature_guard_link()}</a></p>{/if}
          {#if st?.error}<p class="error">{m.feature_read_error({ detail: st.error })}</p>{/if}
          {#if rowError[d.id]}<p class="error">{rowError[d.id]}</p>{/if}
        </div>
        <Switch
          checked={st ? st.enabled : null}
          disabled={busy !== null || !!why}
          label={d.title()}
          onchange={(next) => toggle(d, next)}
        />
      </div>
    </Card>
  {/each}

  <h2 class="section-title">{m.features_fixed_title()}</h2>
  <p class="muted fixed-intro">{m.features_fixed_intro()}</p>
  <div class="fixed">
    {#each fixed as f, i (i)}
      <Card>
        <div class="row"><h2>{f.title()}</h2><Pill>{'notYet' in f ? m.feature_not_yet() : m.feature_always_on()}</Pill></div>
        <p>{f.what()}</p>
        <p class="muted">{f.cost()}</p>
      </Card>
    {/each}
  </div>

  <h2 class="section-title">{m.features_advanced()}</h2>

  <Card title={m.channel_title()}>
    <p class="muted">{m.channel_intro()} <Explain>{m.explain_channel()}</Explain></p>
    {#if channel?.channel === 'frozen'}<p class="note">{m.channel_frozen()}</p>{/if}
    <fieldset class="channels">
      <legend class="sr-only">{m.channel_title()}</legend>
      {#each [{ id: 'stable', t: m.channel_stable(), d: m.channel_stable_desc() }, { id: 'main', t: m.channel_main(), d: m.channel_main_desc() }, { id: 'local', t: m.channel_local(), d: m.channel_local_desc() }, { id: 'custom', t: m.channel_custom(), d: m.channel_custom_desc() }] as c (c.id)}
        <label class="check">
          <input type="radio" name="channel" value={c.id} bind:group={picked} />
          <span><strong>{c.t}</strong><br /><span class="muted">{c.d}</span></span>
        </label>
      {/each}
    </fieldset>
    {#if picked === 'custom'}
      <label class="field">
        {m.channel_custom_url()}
        <input class="mono" bind:value={customUrl} placeholder="https://…/template.zip" />
      </label>
    {/if}
    <div class="row" style="margin-top: 0.75rem">
      <button onclick={saveChannel} disabled={!channel}>{m.save()}</button>
      {#if channelMsg}<span class="muted">{channelMsg}</span>{/if}
    </div>
    {#if channelErr}<p class="error">{channelErr}</p>{/if}
  </Card>

  <Card title={m.rerun_title()} tone="bad">
    <p>{m.rerun_intro()}</p>
    <p class="muted">{m.rerun_detail()}</p>
    {#if resetDone}
      <p class="note">{m.rerun_done({ backup: resetDone.backup || '—' })}</p>
      {#if resetDone.warning}<p class="error">{m.rerun_sessions_warning()}</p>{/if}
      <div class="row"><button class="primary" onclick={() => location.reload()}>{m.rerun_continue()}</button></div>
    {:else}
      <div class="row"><button class="danger" onclick={() => ((resetOpen = true), (resetWord = ''))}>{m.rerun_button()}</button></div>
    {/if}
  </Card>
</div>

<Dialog open={!!confirming} title={confirming?.confirm?.question() ?? ''} onclose={() => (confirming = null)}>
  <p>{confirming?.confirm?.warning()}</p>
  {#snippet actions()}
    <button onclick={() => (confirming = null)}>{m.cancel()}</button>
    <button class="danger" onclick={() => confirming && apply(confirming.id, false)}>{m.feature_turn_off()}</button>
  {/snippet}
</Dialog>

<Dialog open={resetOpen} title={m.rerun_confirm_title()} onclose={() => (resetOpen = false)}>
  <p>{m.rerun_confirm_body()}</p>
  <label class="field">
    {m.rerun_confirm_type({ word: m.rerun_word() })}
    <input bind:value={resetWord} autocomplete="off" />
  </label>
  {#if resetErr}<p class="error">{resetErr}</p>{/if}
  {#snippet actions()}
    <button onclick={() => (resetOpen = false)}>{m.cancel()}</button>
    <button class="danger" disabled={resetBusy || resetWord.trim().toLowerCase() !== m.rerun_word().toLowerCase()} onclick={reset}>
      {resetBusy ? m.working() : m.rerun_button()}
    </button>
  {/snippet}
</Dialog>

<style>
  .feature {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    justify-content: space-between;
  }
  .text {
    min-width: 0;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0;
  }
  .feature p,
  .fixed p {
    margin: 0.5rem 0 0;
  }
  .note {
    background: var(--warn-bg);
    color: var(--warn-fg);
    padding: 0.55rem 0.75rem;
    border-radius: 10px;
  }
  .fixed-intro {
    margin: -0.25rem 0 0.5rem;
  }
  .fixed {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.75rem;
  }
  .channels {
    border: none;
    padding: 0;
    margin: 0.75rem 0;
    display: grid;
    gap: 0.6rem;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
