<script lang="ts">
  import Dialog from '../lib/Dialog.svelte'
  import Explain from '../lib/Explain.svelte'
  import { api, type OnboardingStatus } from '../lib/api'
  import { errorText } from '../lib/t'
  import { readReturnTarget } from './returnTarget'
  import { m } from '../lib/paraglide/messages.js'

  // First run. An unclaimed server has no owner account yet: a blocking
  // dialog creates it (tools/onboarding.sh run). Once claimed but not yet
  // welcomed, a one-time "ready" dialog explains what comes next. A failed
  // status read never blocks the app — the wizard is a convenience, not a gate.
  //
  // Maison sends an unclaimed owner here with ?return=<its URL>; once the box
  // is settled they go straight back (see returnTarget.ts for what is allowed).

  let status = $state<OnboardingStatus | null>(null)
  let username = $state('')
  let displayname = $state(m.onboarding_default_name())
  let password = $state('')
  let confirm = $state('')
  let busy = $state(false)
  let error = $state('')
  let generated = $state('')
  let copied = $state(false)

  const returnTo = readReturnTarget()

  api
    .get<OnboardingStatus>('/api/onboarding/status')
    .then((s) => {
      status = s
      if (s.claimed && returnTo && !generated) location.replace(returnTo)
    })
    .catch(() => (status = null))

  const mismatch = $derived(confirm !== '' && password !== confirm)
  const canSubmit = $derived(/^[a-z_][a-z0-9_-]{0,31}$/.test(username) && displayname.trim() !== '' && password.length >= 8 && password === confirm && !busy)

  async function claim(e: SubmitEvent) {
    e.preventDefault()
    busy = true
    error = ''
    try {
      const res = await api.post<OnboardingStatus & { password?: string }>('/api/onboarding/claim', { username, displayname, password })
      if (res.password) generated = res.password
      status = { claimed: res.claimed, completed: res.completed, username: res.username }
      password = confirm = ''
      if (!generated && returnTo) location.replace(returnTo)
    } catch (err) {
      error = errorText(err)
    } finally {
      busy = false
    }
  }

  async function finish() {
    try {
      await api.post('/api/onboarding/complete')
    } catch {
      // Not worth blocking on: the dialog simply shows again next time.
    }
    if (status) status = { ...status, completed: true }
    if (returnTo) location.replace(returnTo)
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

{#if status && !status.claimed}
  <Dialog open={true} blocking title={m.onboarding_title()} onclose={() => {}}>
    <p>{m.onboarding_intro()}</p>
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
      <div class="row end"><button class="primary" disabled={!canSubmit}>{busy ? m.working() : m.onboarding_create()}</button></div>
    </form>
  </Dialog>
{:else if status && (generated || !status.completed)}
  <Dialog open={true} title={m.onboarding_ready_title()} onclose={finish}>
    {#if generated}
      <p>{m.onboarding_generated()}</p>
      <div class="row"><code class="pw">{generated}</code><button onclick={copy}>{copied ? m.copied() : m.copy()}</button></div>
    {/if}
    <p>{m.onboarding_ready_body({ username: status.username })}</p>
    <ul>
      <li>{m.onboarding_next_apps()}</li>
      <li>{m.onboarding_next_here()}</li>
      <li>{m.onboarding_next_help()}</li>
    </ul>
    {#snippet actions()}
      <button class="primary" onclick={finish}>{returnTo ? m.onboarding_back() : m.onboarding_start()}</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .end {
    justify-content: flex-end;
  }
  .pw {
    font-size: 1rem;
    padding: 0.3rem 0.6rem;
    background: var(--surface-3);
    border-radius: 8px;
    user-select: all;
  }
  ul {
    margin: 0;
    padding-left: 1.2rem;
    display: grid;
    gap: 0.3rem;
  }
</style>
