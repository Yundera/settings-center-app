<script lang="ts">
  import Card from '../lib/Card.svelte'
  import Explain from '../lib/Explain.svelte'
  import Pill from '../lib/Pill.svelte'
  import { api, type Me, type Run, type Schedule, type SelfCheck } from '../lib/api'
  import { cronText, duration, hostStamp } from '../lib/format'
  import { errorText } from '../lib/t'
  import { m } from '../lib/paraglide/messages.js'

  let { me }: { me: Me } = $props()

  let data = $state<SelfCheck | null>(null)
  let error = $state('')
  let starting = $state(false)
  let showAll = $state(false)

  async function load() {
    try {
      data = await api.get<SelfCheck>('/api/selfcheck')
      error = ''
    } catch (e) {
      error = errorText(e)
    }
  }

  // Poll fast while a run is in flight (or one was just asked for), slowly
  // otherwise.
  $effect(() => {
    load()
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      t = setTimeout(
        async () => {
          await load()
          tick()
        },
        data?.running || starting ? 5000 : 30_000,
      )
    }
    tick()
    return () => clearTimeout(t)
  })

  async function runNow() {
    starting = true
    try {
      await api.post('/api/selfcheck/run')
      setTimeout(load, 1500)
      setTimeout(() => (starting = false), 20_000)
    } catch (e) {
      error = errorText(e)
      starting = false
    }
  }

  const run: Run | null = $derived(data?.run ?? null)
  const failed = $derived(run?.scripts.filter((s) => s.status === 'failed') ?? [])
  const runTone = $derived(
    !run ? 'neutral' : run.status === 'success' ? 'ok' : run.status === 'running' ? 'info' : run.status === 'interrupted' ? 'warn' : 'bad',
  )
  const runLabel = $derived(
    !run
      ? ''
      : { success: m.run_success(), failures: m.run_failures(), running: m.run_running(), interrupted: m.run_interrupted() }[run.status],
  )

  // ---- schedule ------------------------------------------------------------
  let schedule = $state<Schedule | null>(null)
  let cronInput = $state('')
  let scheduleMsg = $state('')
  let scheduleErr = $state('')
  api
    .get<Schedule>('/api/selfcheck/schedule')
    .then((s) => {
      schedule = s
      cronInput = s.effective
    })
    .catch((e) => (scheduleErr = errorText(e)))

  async function saveSchedule() {
    scheduleErr = scheduleMsg = ''
    try {
      await api.post('/api/selfcheck/schedule', { value: cronInput })
      schedule = await api.get<Schedule>('/api/selfcheck/schedule')
      scheduleMsg = m.schedule_saved()
    } catch (e) {
      scheduleErr = errorText(e)
    }
  }

  // ---- raw log -------------------------------------------------------------
  let logOpen = $state(false)
  let log = $state('')
  $effect(() => {
    if (!logOpen) return
    const fetchLog = () =>
      api
        .get<{ log: string }>('/api/selfcheck/log?lines=400')
        .then((r) => (log = r.log))
        .catch((e) => (log = errorText(e)))
    fetchLog()
    const t = setInterval(fetchLog, 5000)
    return () => clearInterval(t)
  })
</script>

<div class="page-intro">
  <h1>{m.health_title()}</h1>
  <p>{m.health_intro()}</p>
</div>

<div class="stack">
  <Card title={m.health_last_run()}>
    {#snippet actions()}
      <button class="primary" disabled={data?.running || starting} onclick={runNow}>
        {data?.running || starting ? m.health_running_now() : m.health_run_now()}
      </button>
    {/snippet}
    {#if error}<p class="error">{error}</p>{/if}
    {#if !data}
      <p class="muted">{m.loading()}</p>
    {:else if !run}
      <p class="muted">{m.health_no_run()}</p>
    {:else}
      <div class="row summary">
        <Pill tone={runTone}>{runLabel}</Pill>
        {#if run.total}<span>{m.health_tally({ passed: run.passed, total: run.total })}</span>{/if}
        <span class="muted">{m.health_started({ at: hostStamp(run.startedAt) })}</span>
        {#if run.durationSec !== null}<span class="muted">· {duration(run.durationSec)}</span>{/if}
      </div>
      {#if run.truncated}<p class="subtle">{m.health_truncated()}</p>{/if}

      {#if failed.length}
        <h3 class="sub">{m.health_failed_steps()}</h3>
        <p class="muted">{m.health_failed_help()}</p>
        {#each failed as s (s.name + s.startedAt)}
          <details class="step failed" open>
            <summary><Pill tone="bad">{m.step_failed()}</Pill> <code>{s.name}</code> <span class="muted">{m.step_exit({ code: s.exitCode ?? '?' })}</span></summary>
            {#if s.output.length}<pre class="log">{s.output.join('\n')}</pre>{:else}<p class="subtle">{m.step_no_output()}</p>{/if}
          </details>
        {/each}
      {/if}

      <button class="link" onclick={() => (showAll = !showAll)}>{showAll ? m.health_hide_steps() : m.health_show_steps({ n: run.scripts.length })}</button>
      {#if showAll}
        <ul class="steps">
          {#each run.scripts as s, i (i)}
            <li>
              <Pill tone={s.status === 'success' ? 'ok' : s.status === 'failed' ? 'bad' : 'info'}>
                {s.status === 'success' ? m.step_ok() : s.status === 'failed' ? m.step_failed() : m.step_running()}
              </Pill>
              <code>{s.name}</code>
              {#if s.durationSec !== null}<span class="subtle">{duration(s.durationSec)}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </Card>

  <Card title={m.schedule_title()}>
    <p>
      {schedule ? m.schedule_current({ when: cronText(schedule.effective) }) : m.loading()}
      <Explain>{m.explain_schedule()}</Explain>
    </p>
    <details>
      <summary class="muted">{m.schedule_change()}</summary>
      <div class="stack" style="margin-top: 0.75rem">
        <label class="field">
          {m.schedule_cron_label()}
          <input class="mono" bind:value={cronInput} placeholder="0 3 * * *" />
          <span class="hint">{m.schedule_cron_hint()}</span>
        </label>
        <div class="row">
          <button onclick={saveSchedule}>{m.save()}</button>
          {#if scheduleMsg}<span class="muted">{scheduleMsg}</span>{/if}
        </div>
        {#if scheduleErr}<p class="error">{scheduleErr}</p>{/if}
      </div>
    </details>
  </Card>

  <Card title={m.log_title()}>
    <p class="muted">{m.log_intro()}</p>
    <button class="link" onclick={() => (logOpen = !logOpen)}>{logOpen ? m.log_hide() : m.log_show()}</button>
    {#if logOpen}<pre class="log" style="margin-top: 0.75rem">{log || m.loading()}</pre>{/if}
  </Card>
</div>

<style>
  .summary {
    margin-bottom: 0.5rem;
  }
  .sub {
    font-size: 0.95rem;
    margin: 1rem 0 0.25rem;
  }
  .step {
    margin: 0.5rem 0;
  }
  .step summary {
    cursor: pointer;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 0.4rem;
  }
  .steps {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    display: grid;
    gap: 0.3rem;
  }
  .steps li {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  details > summary {
    cursor: pointer;
  }
</style>
