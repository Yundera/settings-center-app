<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    actions,
    children,
    tone,
  }: { title?: string; actions?: Snippet; children: Snippet; tone?: 'ok' | 'warn' | 'bad' | 'info' | 'unknown' } = $props()
</script>

<section class="card {tone ?? ''}" class:toned={!!tone}>
  {#if title || actions}
    <header>
      {#if title}<h2>{title}</h2>{/if}
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </header>
  {/if}
  {@render children()}
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 1.1rem 1.25rem;
    min-width: 0;
    box-shadow: var(--shadow-card);
  }
  .toned {
    border-left-width: 4px;
  }
  .ok {
    border-left-color: var(--ok-fg);
  }
  .warn {
    border-left-color: var(--warn-fg);
  }
  .bad {
    border-left-color: var(--bad-fg);
  }
  .info {
    border-left-color: var(--info-fg);
  }
  .unknown {
    border-left-color: var(--border-strong);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
</style>
