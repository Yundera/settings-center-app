<script lang="ts">
  import Explain from '../../lib/Explain.svelte'
  import PasswordField from '../../lib/PasswordField.svelte'
  import Switch from '../../lib/Switch.svelte'
  import { api, type Feature, type OnboardingStatus } from '../../lib/api'
  import { errorText } from '../../lib/t'
  import { m } from '../../lib/paraglide/messages.js'

  // Slide 1: the owner account (tools/onboarding.sh run) and whether Yundera
  // Login stays on. Until the account exists Yundera Login is the only way in,
  // so it stays on: switching it off here is a choice applied right after the
  // claim succeeds (POST /api/features, whose own guard refuses it before).
  let {
    status,
    onclaimed,
  }: {
    status: OnboardingStatus
    onclaimed: (s: { claimed: boolean; completed: boolean; username: string }) => void
  } = $props()

  let username = $state('')
  let password = $state('')
  let pwValid = $state(false)
  let busy = $state(false)
  let error = $state('')
  let generated = $state('')
  let copied = $state(false)

  // The host's answer; null = unknown (the switch is then disabled).
  let login = $state<boolean | null>(null)
  // Before the claim: what the owner wants once the account exists.
  let keepLogin = $state(true)
  let loginBusy = $state(false)
  let loginError = $state('')

  api
    .get<{ features: Feature[] }>('/api/features')
    .then((r) => (login = r.features.find((f) => f.id === 'yundera-login')?.enabled ?? null))
    .catch(() => (login = null))

  const canSubmit = $derived(/^[a-z_][a-z0-9_-]{0,31}$/.test(username) && pwValid && !busy)

  async function claim(e: SubmitEvent) {
    e.preventDefault()
    busy = true
    error = ''
    try {
      const res = await api.post<{ claimed: boolean; completed: boolean; username: string; password?: string }>('/api/onboarding/claim', {
        username,
        password,
      })
      if (res.password) generated = res.password
      password = ''
      onclaimed({ claimed: res.claimed, completed: res.completed, username: res.username })
      if (!keepLogin) await setLogin(false)
    } catch (err) {
      error = errorText(err)
    } finally {
      busy = false
    }
  }

  async function setLogin(enabled: boolean) {
    loginBusy = true
    loginError = ''
    try {
      const f = await api.post<Feature>('/api/features', { id: 'yundera-login', enabled })
      login = f.enabled
    } catch (err) {
      loginError = errorText(err)
    } finally {
      loginBusy = false
    }
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

<h1>{status.claimed ? m.account_done_title() : m.onboarding_title()}</h1>

{#if !status.claimed}
  <p class="lead">{m.onboarding_intro()}</p>
  <form class="stack" onsubmit={claim}>
    <label class="field">
      {m.onboarding_username()}
      <input bind:value={username} oninput={() => (username = username.toLowerCase())} autocomplete="username" autocapitalize="off" spellcheck="false" required />
      <span class="hint">{m.onboarding_username_hint()}</span>
    </label>
    <PasswordField bind:value={password} bind:valid={pwValid} min={8} label={m.onboarding_password()} disabled={busy}>
      {#snippet explain()}<Explain>{m.explain_password()}</Explain>{/snippet}
    </PasswordField>

    <div class="login">
      <div class="row between">
        <span class="name">{m.feature_login_title()} <Explain>{m.feature_login_what()}</Explain></span>
        <Switch checked={keepLogin} label={m.feature_login_title()} disabled={busy} onchange={(v) => (keepLogin = v)} />
      </div>
      <p class="hint">{keepLogin ? m.account_login_keep() : m.account_login_off_after()}</p>
    </div>

    {#if error}<p class="error">{error}</p>{/if}
    <button class="primary wide" disabled={!canSubmit}>{busy ? m.working() : m.onboarding_create()}</button>
  </form>
{:else}
  <p class="done">✓ {m.account_done({ username: status.username })}</p>
  {#if generated}
    <div class="secret">
      <p>{m.onboarding_generated()}</p>
      <div class="row"><code class="pw">{generated}</code><button type="button" onclick={copy}>{copied ? m.copied() : m.copy()}</button></div>
    </div>
  {/if}
  <div class="login">
    <div class="row between">
      <span class="name">{m.feature_login_title()} <Explain>{m.feature_login_what()}</Explain></span>
      <Switch checked={login} label={m.feature_login_title()} disabled={loginBusy} onchange={setLogin} />
    </div>
    <p class="hint">{login === false ? m.feature_login_cost() : m.account_login_on()}</p>
    {#if loginError}<p class="error">{loginError}</p>{/if}
  </div>
{/if}

<style>
  .login {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.7rem 0.9rem;
    margin-top: 0.25rem;
  }
  .between {
    justify-content: space-between;
    flex-wrap: nowrap;
  }
  .name {
    font-weight: 600;
  }
  .login .hint {
    margin: 0.4rem 0 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .done {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--ok-fg);
    background: var(--ok-bg);
    border-radius: 12px;
    padding: 0.6rem 0.9rem;
    margin: 0.5rem 0 1rem;
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
</style>
