<script lang="ts">
  import AccountSlide from './slides/AccountSlide.svelte'
  import BackupSlide from './slides/BackupSlide.svelte'
  import { api, type BackupStatus, type Me, type OnboardingStatus, type Slide, type SlideId } from '../lib/api'
  import { readReturnTarget } from './returnTarget'
  import { m } from '../lib/paraglide/messages.js'
  import { getLocale, locales, setLocale } from '../lib/paraglide/runtime.js'

  // First run, as a page of its own (not a dialog over the app): it is the
  // owner's first contact with their server, right after the Yundera sign-in,
  // and uses the same cloud background so the two read as one journey.
  //
  // One slide per topic (slides/), Back / Next / "Skip for now", then a
  // closing card that marks the onboarding completed. It opens on the first
  // slide still pending; a skipped slide comes back 3 days later (the server
  // keeps the times, internal/onboarding). Maison sends the owner here with
  // ?return=<its URL> while a slide is pending; once settled they go straight
  // back (returnTarget.ts).
  let {
    me,
    status,
    ondone,
  }: { me: Me; status: OnboardingStatus; ondone: (s: OnboardingStatus) => void } = $props()

  const localeNames: Record<string, string> = { en: 'English', fr: 'Français', ko: '한국어' }
  const returnTo = readReturnTarget()

  // A starting copy on purpose: from here the page tracks the slides itself.
  // svelte-ignore state_referenced_locally
  let current = $state<OnboardingStatus>({ ...status, slides: status.slides.map((s) => ({ ...s })) })
  // The closing card is one step past the last slide.
  const total = $derived(current.slides.length + 1)
  // Open on the first pending slide; with none (only the closing card is
  // left, e.g. the tab was closed right after the claim), on the closing card.
  // svelte-ignore state_referenced_locally
  const firstPending = status.slides.findIndex((s) => s.state === 'pending')
  // svelte-ignore state_referenced_locally
  let step = $state(firstPending >= 0 ? firstPending : status.slides.length)
  let busy = $state(false)

  const slide = $derived<Slide | null>(step < current.slides.length ? current.slides[step] : null)
  const skipped = $derived(current.slides.some((s) => s.state !== 'done'))

  function mark(id: SlideId, state: Slide['state'], skippedAt?: string) {
    current.slides = current.slides.map((s) => (s.id === id ? { ...s, state, skippedAt: skippedAt ?? s.skippedAt } : s))
  }

  function onclaimed(s: { claimed: boolean; completed: boolean; username: string }) {
    current.claimed = s.claimed
    current.completed = s.completed
    current.username = s.username
    if (s.claimed) mark('account', 'done')
  }

  function onbackup(b: BackupStatus) {
    current.backup = b
    const settled = b.state === 'ready' || b.state === 'disabled'
    const was = current.slides.find((s) => s.id === 'backup')
    if (settled) mark('backup', 'done')
    else if (was?.state === 'done') mark('backup', 'pending')
  }

  function next() {
    if (step < total - 1) step++
    scrollTo(0, 0)
  }

  async function skip() {
    if (!slide) return
    busy = true
    try {
      const r = await api.post<{ skippedAt: string }>('/api/onboarding/skip', { slide: slide.id })
      mark(slide.id, 'skipped', r.skippedAt)
    } catch {
      // Not worth blocking on: the slide simply comes back sooner.
      mark(slide.id, 'skipped')
    } finally {
      busy = false
    }
    next()
  }

  // Backups unavailable: skip the slide so the gate lets the owner reach the
  // Support page, then go there.
  async function toSupport() {
    await skip()
    await finish('/support')
  }

  async function finish(to?: string) {
    busy = true
    try {
      await api.post('/api/onboarding/complete')
    } catch {
      // Not worth blocking on: the closing card simply shows again next time.
    }
    const done: OnboardingStatus = { ...current, completed: true }
    if (to) location.assign(to)
    else if (returnTo) location.replace(returnTo)
    else ondone(done)
  }

  const label = (id: SlideId) => (id === 'account' ? m.onboarding_step_account() : m.onboarding_step_backup())
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
        {#each current.slides as sl, i (sl.id)}
          <li class:active={step === i} class:done={sl.state === 'done'} class:skipped={sl.state === 'skipped'}>
            <span>{sl.state === 'done' ? '✓' : i + 1}</span><em>{label(sl.id)}</em>
          </li>
        {/each}
        <li class:active={step === total - 1}><span>{total}</span><em>{m.onboarding_step_ready()}</em></li>
      </ol>

      {#if slide?.id === 'account'}
        <AccountSlide status={current} {onclaimed} />
      {:else if slide?.id === 'backup'}
        <BackupSlide backup={current.backup} onchange={onbackup} onsupport={toSupport} />
      {:else}
        <h1>{m.onboarding_done_title()}</h1>
        <p class="lead">{current.claimed ? m.onboarding_ready_body({ username: current.username }) : m.onboarding_done_body()}</p>
        {#if skipped}<p class="later">{m.onboarding_done_skipped()}</p>{/if}
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

      {#if slide}
        <nav class="nav">
          <button type="button" disabled={busy || step === 0} onclick={() => (step--, scrollTo(0, 0))}>{m.onboarding_prev()}</button>
          {#if slide.state === 'done'}
            <button type="button" class="primary" disabled={busy} onclick={next}>{m.onboarding_next()}</button>
          {:else}
            <button type="button" class="link" disabled={busy} onclick={skip}>{m.onboarding_skip()}</button>
          {/if}
        </nav>
        {#if slide.state !== 'done'}<p class="skiphint">{m.onboarding_skip_hint()}</p>{/if}
      {:else if step > 0}
        <nav class="nav"><button type="button" disabled={busy} onclick={() => (step--, scrollTo(0, 0))}>{m.onboarding_prev()}</button></nav>
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
  .panel :global(h1) {
    font-size: 1.6rem;
    margin: 0.25rem 0 0.5rem;
  }
  .panel :global(.lead) {
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
  .steps li.skipped span {
    background: var(--warn-bg);
    color: var(--warn-fg);
  }
  .steps em {
    font-style: normal;
  }
  @media (max-width: 420px) {
    .steps li:not(.active) em {
      display: none;
    }
  }
  .nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }
  .skiphint {
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
    color: var(--text-subtle);
    text-align: right;
  }
  .later {
    background: var(--warn-bg);
    color: var(--warn-fg);
    border-radius: 12px;
    padding: 0.6rem 0.9rem;
    margin: 0 0 1rem;
  }
  .panel :global(.wide) {
    width: 100%;
    justify-content: center;
    padding: 0.7rem 1rem;
    font-size: 1rem;
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
