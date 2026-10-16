<script lang="ts">
  import Explain from '../../lib/Explain.svelte'
  import PasswordField from '../../lib/PasswordField.svelte'
  import Switch from '../../lib/Switch.svelte'
  import { api, ApiError, type BackupAction, type BackupJob, type BackupStatus } from '../../lib/api'
  import { errorText } from '../../lib/t'
  import { m } from '../../lib/paraglide/messages.js'

  // Slide 2: backups (tools/backup.sh through POST /api/backup). A new server
  // has its backup space ready but no password: the repository is created
  // only once the owner chooses one (init). A rebuilt server finds the old
  // backups and needs the old password back (recover) — or the owner starts
  // over, which wipes the space (reset) and then asks for a new password.
  let {
    backup,
    onchange,
    onsupport,
  }: { backup: BackupStatus; onchange: (b: BackupStatus) => void; onsupport: () => void } = $props()

  const MIN = 16
  let password = $state('')
  let pwValid = $state(false)
  let formKey = $state(0)
  let busy = $state(false)
  let error = $state('')

  // needs-recovery: which way out the owner picked.
  let path = $state<'restore' | 'restart' | null>(null)
  let word = $state('')

  // status answers at once; every other action is a server-side job (init can
  // take minutes, recover far longer): POST starts it, then we poll its result.
  async function act(action: BackupAction, body: Record<string, unknown> = {}): Promise<BackupStatus | null> {
    busy = true
    error = ''
    try {
      if (action === 'status') {
        const st = await api.post<BackupStatus>('/api/backup', { action })
        onchange(st)
        return st
      }
      await api.post<BackupJob>('/api/backup', { action, ...body })
      return await follow()
    } catch (err) {
      error = errorText(err)
      return null
    } finally {
      busy = false
    }
  }

  async function follow(): Promise<BackupStatus | null> {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000))
      const j = await api.get<BackupJob>('/api/backup/job')
      if (j.job === 'running') continue
      if (j.job === 'failed') {
        error = errorText(new ApiError(500, j.error ?? '', j.code))
        return null
      }
      if (j.backup) onchange(j.backup)
      return j.backup ?? null
    }
  }

  // A job started before a reload is still running: wait for it.
  api
    .get<BackupJob>('/api/backup/job')
    .then(async (j) => {
      if (j.job !== 'running') return
      busy = true
      try {
        await follow()
      } catch (err) {
        error = errorText(err)
      } finally {
        busy = false
      }
    })
    .catch(() => {})

  async function choose(e: SubmitEvent) {
    e.preventDefault()
    if (await act('init', { password })) clearPassword()
  }

  async function restore(e: SubmitEvent) {
    e.preventDefault()
    if (await act('recover', { password })) clearPassword()
  }

  // Starting over wipes the space through Yundera, then the box re-reads it;
  // until it reports the empty space, ask again for a little while.
  async function restart() {
    let st = await act('reset', { confirm: true })
    for (let i = 0; st && st.state === 'needs-recovery' && i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      st = await act('status')
    }
    if (st) {
      path = null
      word = ''
    }
  }

  function clearPassword() {
    password = ''
    formKey++
  }

  const recoverValid = $derived([...password].length >= MIN && !/[\r\n\0]/.test(password))
</script>

<h1>{m.backup_title()}</h1>
<p class="lead">{m.backup_intro()}</p>

{#if backup.state !== 'unavailable'}
  <div class="toggle">
    <div class="row between">
      <span class="name">{m.backup_switch()} <Explain>{m.explain_backup()}</Explain></span>
      <Switch
        checked={backup.enabled}
        label={m.backup_switch()}
        disabled={busy}
        onchange={(v) => {
          path = null
          act(v ? 'enable' : 'disable')
        }}
      />
    </div>
  </div>
{/if}

{#if backup.state === 'ready'}
  <p class="done">✓ {m.backup_ready()}</p>
  <p class="muted">{m.backup_ready_body()}</p>
{:else if backup.state === 'disabled'}
  <p class="warn">{m.backup_disabled()}</p>
{:else if backup.state === 'needs-secret'}
  <p class="warn">{m.backup_not_yet()}</p>
  <p>{m.backup_choose_intro()} <Explain>{m.explain_backup_password()}</Explain></p>
  <form class="stack" onsubmit={choose}>
    {#key formKey}
      <PasswordField bind:value={password} bind:valid={pwValid} min={MIN} label={m.backup_password()} requireSaved disabled={busy} />
    {/key}
    {#if error}<p class="error">{error}</p>{/if}
    <button class="primary wide" disabled={!pwValid || busy}>{busy ? m.backup_working() : m.backup_start()}</button>
  </form>
{:else if backup.state === 'needs-recovery'}
  <p class="warn">{m.backup_found()}</p>
  <div class="choices" role="radiogroup" aria-label={m.backup_found()}>
    <button type="button" class="choice" class:picked={path === 'restore'} role="radio" aria-checked={path === 'restore'} onclick={() => ((path = 'restore'), (error = ''))}>
      <strong>{m.backup_restore_title()}</strong>
      <span>{m.backup_restore_desc()}</span>
    </button>
    <button type="button" class="choice" class:picked={path === 'restart'} role="radio" aria-checked={path === 'restart'} onclick={() => ((path = 'restart'), (error = ''))}>
      <strong>{m.backup_restart_title()}</strong>
      <span>{m.backup_restart_desc()}</span>
    </button>
  </div>

  {#if path === 'restore'}
    <form class="stack" onsubmit={restore}>
      <label class="field">
        {m.backup_old_password()}
        {#key formKey}
          <input type="password" bind:value={password} autocomplete="current-password" autocapitalize="off" spellcheck="false" disabled={busy} required />
        {/key}
        <span class="hint">{m.backup_old_password_hint()}</span>
      </label>
      {#if error}<p class="error">{error}</p>{/if}
      <button class="primary wide" disabled={!recoverValid || busy}>{busy ? m.backup_working() : m.backup_restore_button()}</button>
    </form>
  {:else if path === 'restart'}
    <div class="stack danger-zone">
      <p>{m.backup_restart_warning()}</p>
      <label class="field">
        {m.rerun_confirm_type({ word: m.backup_restart_word() })}
        <input bind:value={word} autocomplete="off" disabled={busy} />
      </label>
      {#if error}<p class="error">{error}</p>{/if}
      <button type="button" class="danger wide" disabled={busy || word.trim().toLowerCase() !== m.backup_restart_word().toLowerCase()} onclick={restart}>
        {busy ? m.backup_working() : m.backup_restart_button()}
      </button>
    </div>
  {/if}
{:else}
  <p class="warn">{m.backup_unavailable()}</p>
  <p class="muted">{m.backup_unavailable_body()}</p>
  {#if error}<p class="error">{error}</p>{/if}
  <div class="row">
    <button type="button" onclick={onsupport}>{m.backup_contact_support()}</button>
    <button type="button" class="link" disabled={busy} onclick={() => act('status')}>{m.backup_check_again()}</button>
  </div>
{/if}

{#if error && (backup.state === 'ready' || backup.state === 'disabled' || (backup.state === 'needs-recovery' && path === null))}<p class="error">{error}</p>{/if}

<style>
  .toggle {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.7rem 0.9rem;
    margin-bottom: 1rem;
  }
  .between {
    justify-content: space-between;
    flex-wrap: nowrap;
  }
  .name {
    font-weight: 600;
  }
  .done {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--ok-fg);
    background: var(--ok-bg);
    border-radius: 12px;
    padding: 0.6rem 0.9rem;
    margin: 0 0 0.75rem;
  }
  .warn {
    color: var(--warn-fg);
    background: var(--warn-bg);
    border-radius: 12px;
    padding: 0.6rem 0.9rem;
    margin: 0 0 0.75rem;
    font-weight: 600;
  }
  .choices {
    display: grid;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }
  .choice {
    display: grid;
    gap: 0.2rem;
    text-align: left;
    justify-items: start;
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    font-weight: 400;
  }
  .choice strong {
    font-family: var(--font-brand);
  }
  .choice span {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .choice.picked {
    border-color: var(--primary);
    background: var(--primary-soft);
  }
  .danger-zone p {
    margin: 0;
  }
</style>
