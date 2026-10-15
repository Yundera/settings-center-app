<script lang="ts">
  import Card from '../lib/Card.svelte'
  import Dialog from '../lib/Dialog.svelte'
  import Explain from '../lib/Explain.svelte'
  import Pill from '../lib/Pill.svelte'
  import Switch from '../lib/Switch.svelte'
  import { api, type Me, type Support } from '../lib/api'
  import { errorText } from '../lib/t'
  import { m } from '../lib/paraglide/messages.js'

  let { me }: { me: Me } = $props()

  let sup = $state<Support | null>(null)
  let error = $state('')
  let busy = $state(false)
  let confirmOff = $state(false)

  async function load() {
    try {
      sup = await api.get<Support>('/api/support')
      error = ''
    } catch (e) {
      error = errorText(e)
    }
  }

  async function setEnsure(ensure: boolean) {
    confirmOff = false
    busy = true
    error = ''
    try {
      sup = await api.post<Support>('/api/support', { ensure })
    } catch (e) {
      error = errorText(e)
    } finally {
      busy = false
    }
  }

  // `?autoEnable=1` comes from the Yundera dashboard ("let support in"): turn
  // access on once, then drop the flag so a reload does not repeat it.
  const params = new URLSearchParams(location.search)
  const auto = params.get('autoEnable') === '1'
  if (auto) {
    params.delete('autoEnable')
    const q = params.toString()
    history.replaceState(null, '', location.pathname + (q ? '?' + q : ''))
  }
  load().then(() => {
    if (auto && sup && !sup.accessEnabled) setEnsure(true)
  })

  // ---- report -------------------------------------------------------------
  let subject = $state('')
  let message = $state('')
  let includeLog = $state(true)
  let grantAccess = $state(false)
  let sending = $state(false)
  let sent = $state<{ to: string; grantedAccess: boolean } | null>(null)
  let sendError = $state('')

  async function send(e: SubmitEvent) {
    e.preventDefault()
    sending = true
    sendError = ''
    try {
      sent = await api.post<{ to: string; grantedAccess: boolean }>('/api/support/report', { subject, message, includeLog, grantAccess })
      subject = message = ''
      if (grantAccess) load()
    } catch (err) {
      sendError = errorText(err)
    } finally {
      sending = false
    }
  }
</script>

<div class="page-intro">
  <h1>{m.support_title()}</h1>
  <p>{m.support_intro()}</p>
</div>

<div class="stack">
  <Card title={m.access_title()}>
    {#snippet actions()}
      {#if sup}<Pill tone={sup.accessEnabled ? 'ok' : 'neutral'}>{sup.accessEnabled ? m.access_on() : m.access_off()}</Pill>{/if}
    {/snippet}
    <div class="feature">
      <div>
        <p>{m.access_what()} <Explain>{m.explain_ssh()}</Explain></p>
        <p class="muted">{m.access_privacy()}</p>
      </div>
      <Switch checked={sup ? sup.ensure : null} disabled={busy} label={m.access_title()} onchange={(next) => (next ? setEnsure(true) : (confirmOff = true))} />
    </div>
    {#if sup && sup.ensure && !sup.accessEnabled}<p class="note">{m.access_pending()}</p>{/if}
    {#if sup && !sup.ensure && sup.accessEnabled}<p class="note">{m.access_still_present()}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
    {#if sup}
      <details>
        <summary class="muted">{m.technical_details()}</summary>
        <dl class="kv" style="margin-top: 0.5rem">
          <dt>{m.access_account()}</dt>
          <dd><code>{sup.username}</code></dd>
          <dt>{m.access_fingerprint()}</dt>
          <dd><code>{sup.fingerprint}</code></dd>
          <dt>{m.access_comment()}</dt>
          <dd><code>{sup.comment}</code></dd>
        </dl>
        <p class="muted">{m.access_own_keys()} <a href={me.links.authAccess}>{m.access_own_keys_link()}</a></p>
      </details>
    {/if}
  </Card>

  <Card title={m.report_title()}>
    <p class="muted">{m.report_intro()}</p>
    {#if sent}
      <p class="ok-note">{m.report_sent({ to: sent.to })}</p>
      {#if sent.grantedAccess}<p class="muted">{m.report_sent_access()}</p>{/if}
      <button class="link" onclick={() => (sent = null)}>{m.report_another()}</button>
    {:else}
      <form class="stack" onsubmit={send}>
        <label class="field">
          {m.report_subject()}
          <input bind:value={subject} maxlength="200" required placeholder={m.report_subject_placeholder()} />
        </label>
        <label class="field">
          {m.report_message()}
          <textarea bind:value={message} rows="7" maxlength="10000" required placeholder={m.report_message_placeholder()}></textarea>
          <span class="hint">{message.length} / 10000</span>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={includeLog} />
          <span>{m.report_include_log()} <Explain>{m.explain_log()}</Explain></span>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={grantAccess} />
          <span>{m.report_grant_access()}</span>
        </label>
        {#if sendError}<p class="error">{sendError}</p>{/if}
        <div class="row"><button class="primary" disabled={sending || !subject.trim() || !message.trim()}>{sending ? m.working() : m.report_send()}</button></div>
      </form>
    {/if}
  </Card>
</div>

<Dialog open={confirmOff} title={m.feature_support_confirm()} onclose={() => (confirmOff = false)}>
  <p>{m.feature_support_warning()}</p>
  {#snippet actions()}
    <button onclick={() => (confirmOff = false)}>{m.cancel()}</button>
    <button class="danger" onclick={() => setEnsure(false)}>{m.feature_turn_off()}</button>
  {/snippet}
</Dialog>

<style>
  .feature {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    justify-content: space-between;
  }
  .feature p {
    margin: 0 0 0.5rem;
  }
  .note {
    background: var(--warn-bg);
    color: var(--warn-fg);
    padding: 0.55rem 0.75rem;
    border-radius: 10px;
  }
  .ok-note {
    background: var(--ok-bg);
    color: var(--ok-fg);
    padding: 0.55rem 0.75rem;
    border-radius: 10px;
  }
  details > summary {
    cursor: pointer;
  }
</style>
