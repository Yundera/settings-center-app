<script lang="ts">
  import type { Snippet } from 'svelte'
  import { m } from './paraglide/messages.js'

  // A small "?" after a term that opens a one-paragraph explanation in place.
  // Most owners are new to self-hosting: every technical word on a page gets
  // one, so the page reads plainly for them and stays short for everyone else.
  let { label, children }: { label?: string; children: Snippet } = $props()
  let open = $state(false)
  const id = `explain-${Math.random().toString(36).slice(2, 9)}`
</script>

<button
  type="button"
  class="q"
  aria-expanded={open}
  aria-controls={id}
  title={label ?? m.explain_what()}
  onclick={() => (open = !open)}>?</button
>
{#if open}
  <span class="text" {id} role="note">{@render children()}</span>
{/if}

<style>
  .q {
    width: 1.25rem;
    height: 1.25rem;
    padding: 0;
    border-radius: 50%;
    font-size: 0.72rem;
    line-height: 1;
    justify-content: center;
    vertical-align: 0.1em;
    margin-left: 0.25rem;
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-soft);
  }
  .text {
    display: block;
    margin: 0.4rem 0 0.2rem;
    padding: 0.55rem 0.75rem;
    border-radius: 10px;
    background: var(--primary-soft);
    color: var(--text);
    font-weight: 400;
    font-size: 0.85rem;
  }
</style>
