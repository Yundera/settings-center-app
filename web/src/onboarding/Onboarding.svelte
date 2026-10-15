<script lang="ts">
  import Explain from '../lib/Explain.svelte'
  import { api, type Me, type OnboardingStatus } from '../lib/api'
  import { errorText } from '../lib/t'
  import { readReturnTarget } from './returnTarget'
  import { m } from '../lib/paraglide/messages.js'
  import { getLocale, locales, setLocale } from '../lib/paraglide/runtime.js'

  // First run, as a page of its own (not a dialog over the app): it is the
  // owner's first contact with their server, right after the Yundera sign-in,
  // and uses the same cloud background so the two read as one journey.
  //
  // Step 1 claims the box (tools/onboarding.sh run) for an unclaimed server.
  // Step 2 welcomes a claimed-but-not-welcomed one and says what comes next;
  // finishing marks it completed. Maison sends an unclaimed owner here with
  // ?return=<its URL>; once settled they go straight back (returnTarget.ts).
  let {
    me,
    status,
    ondone,
  }: { me: Me; status: OnboardingStatus; ondone: (s: OnboardingStatus) => void } = $props()

  const localeNames: Record<string, string> = { en: 'English', fr: 'Français', ko: '한국어' }
  const returnTo = readReturnTarget()

  // A starting copy on purpose: from here the page tracks the claim itself.
  // svelte-ignore state_referenced_locally
  let current = $state<OnboardingStatus>({ ...status })
  let username = $state('')
  let displayname = $state(m.onboarding_default_name())
  let password = $state('')
  let confirm = $state('')
  let busy = $state(false)
  let error = $state('')
  let generated = $state('')
  let copied = $state(false)

  const step = $derived(current.claimed ? 2 : 1)
  const mismatch = $derived(confirm !== '' && password !== confirm)
  const canSubmit = $derived(
    /^[a-z_][a-z0-9_-]{0,31}$/.test(username) && displayname.trim() !== '' && password.length >= 8 && password === confirm && !busy,
  )

  async function claim(e: SubmitEvent) {
    e.preventDefault()
    busy = true
    error = ''
    try {
      const res = await api.post<OnboardingStatus & { password?: string }>('/api/onboarding/claim', { username, displayname, password })
      if (res.password) generated = res.password
      current = { claimed: res.claimed, completed: res.completed, username: res.username }
      password = confirm = ''
    } catch (err) {
      error = errorText(err)
    } finally {
      busy = false
    }
  }

  async function finish(to?: string) {
    busy = true
    try {
      await api.post('/api/onboarding/complete')
    } catch {
      // Not worth blocking on: the page simply shows again next time.
    }
    const done = { ...current, completed: true }
    if (to) location.assign(to)
    else if (returnTo) location.replace(returnTo)
    else ondone(done)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(generated)
      copied = true
    } catch {
      copied = false
    }
  }
</script>

<div class="screen">
  <header>
    <div class="brand"><img src="/icon.svg" alt="" width="34" height="34" /><span>Yundera</span></div>
    <select aria-label={m.language()} value={getLocale()} onchange={(e) => setLocale((e.currentTarget as HTMLSelectElement).value as (typeof locales)[number])}>
      {#each locales as l (l)}
        <option value={l}>{localeNames[l] ?? l}</option>
      {/each}
    </select>
  </header>

  <main>
    <section class="panel">
      <ol class="steps" aria-label={m.onboarding_steps()}>
        <li class:active={step === 1} class:done={step > 1}><span>1</span>{m.onboarding_step_account()}</li>
        <li class:active={step === 2}><span>2</span>{m.onboarding_step_ready()}</li>
      </ol>

      {#if step === 1}
        <h1>{m.onboarding_title()}</h1>
        <p class="lead">{m.onboarding_intro()}</p>
        <form class="stack" onsubmit={claim}>
          <label class="field">
            {m.onboarding_username()}
            <input bind:value={username} oninput={() => (username = username.toLowerCase())} autocomplete="username" autocapitalize="off" spellcheck="false" required />
            <span class="hint">{m.onboarding_username_hint()}</span>
          </label>
          <label class="field">
            {m.onboarding_displayname()}
            <input bind:value={displayname} maxlength="64" required />
          </label>
          <label class="field">
            <span>{m.onboarding_password()} <Explain>{m.explain_password()}</Explain></span>
            <input type="password" bind:value={password} autocomplete="new-password" required minlength="8" />
            <span class="hint">{m.onboarding_password_hint()}</span>
          </label>
          <label class="field">
            {m.onboarding_confirm()}
            <input type="password" bind:value={confirm} autocomplete="new-password" required />
            {#if mismatch}<span class="hint error">{m.onboarding_mismatch()}</span>{/if}
          </label>
          {#if error}<p class="error">{error}</p>{/if}
          <button class="primary wide" disabled={!canSubmit}>{busy ? m.working() : m.onboarding_create()}</button>
        </form>
      {:else}
        <h1>{m.onboarding_ready_title()}</h1>
        {#if generated}
          <div class="secret">
            <p>{m.onboarding_generated()}</p>
            <div class="row"><code class="pw">{generated}</code><button onclick={copy}>{copied ? m.copied() : m.copy()}</button></div>
          </div>
        {/if}
        <p class="lead">{m.onboarding_ready_body({ username: current.username })}</p>
        <ul class="next">
          <li><strong>{m.onboarding_next_apps_title()}</strong> {m.onboarding_next_apps()}</li>
          <li><strong>{m.onboarding_next_here_title()}</strong> {m.onboarding_next_here()}</li>
          <li><strong>{m.onboarding_next_help_title()}</strong> {m.onboarding_next_help()}</li>
        </ul>
        <div class="actions">
          {#if returnTo}
            <button class="primary wide" disabled={busy} onclick={() => finish()}>{m.onboarding_back()}</button>
          {:else}
            <button class="primary wide" disabled={busy} onclick={() => finish(me.links.maison)}>{m.open_my_apps()}</button>
            <button class="link" disabled={busy} onclick={() => finish()}>{m.onboarding_to_settings()}</button>
          {/if}
        </div>
      {/if}
    </section>
  </main>
</div>

<style>
  .screen {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    background:
      linear-gradient(180deg, rgb(7 33 53 / 0.15), rgb(7 33 53 / 0.35)),
      url('/onboarding-bg.jpg') center / cover no-repeat;
    z-index: 50;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px clamp(16px, 4vw, 40px);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-family: var(--font-brand);
    font-weight: 700;
    font-size: 1.35rem;
    color: #fff;
    text-shadow: 0 1px 6px rgb(7 33 53 / 0.45);
  }
  header select {
    background: rgb(255 255 255 / 0.85);
    color: #294056;
    border-color: transparent;
    font-size: 0.85rem;
  }
  main {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 1rem 16px 3rem;
  }
  .panel {
    width: min(480px, 100%);
    background: var(--surface);
    border-radius: 20px;
    padding: clamp(1.25rem, 4vw, 2.25rem);
    box-shadow: 0 20px 60px rgb(7 33 53 / 0.3);
    position: relative;
    overflow: hidden;
  }
  .panel::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 5px;
    background: var(--brand-gradient);
  }
  h1 {
    font-size: 1.6rem;
    margin: 0.25rem 0 0.5rem;
  }
  .lead {
    color: var(--text-muted);
    margin: 0 0 1.25rem;
  }
  .steps {
    display: flex;
    gap: 1.25rem;
    list-style: none;
    padding: 0;
    margin: 0 0 1.25rem;
    font-size: 0.8rem;
    color: var(--text-subtle);
  }
  .steps li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .steps span {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 700;
    background: var(--surface-3);
    color: var(--text-muted);
  }
  .steps li.active {
    color: var(--text);
    font-weight: 600;
  }
  .steps li.active span {
    background: var(--primary);
    color: var(--text-on-accent);
  }
  .steps li.done span {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }
  .wide {
    width: 100%;
    justify-content: center;
    padding: 0.7rem 1rem;
    font-size: 1rem;
  }
  .secret {
    background: var(--warn-bg);
    color: var(--warn-fg);
    border-radius: 12px;
    padding: 0.75rem 0.9rem;
    margin-bottom: 1rem;
  }
  .secret p {
    margin: 0 0 0.5rem;
  }
  .pw {
    font-size: 1rem;
    padding: 0.3rem 0.6rem;
    background: var(--surface);
    color: var(--text);
    border-radius: 8px;
    user-select: all;
    overflow-wrap: anywhere;
  }
  .next {
    margin: 0 0 1.5rem;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.75rem;
  }
  .next li {
    padding-left: 1rem;
    border-left: 3px solid var(--surface-3);
  }
  .next strong {
    display: block;
    font-family: var(--font-brand);
  }
  .actions {
    display: grid;
    gap: 0.75rem;
    justify-items: center;
  }
</style>
