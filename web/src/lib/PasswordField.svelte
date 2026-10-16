<script lang="ts">
  import type { Snippet } from 'svelte'
  import { m } from './paraglide/messages.js'

  // A new password, the way a newcomer needs it: the rules shown up front and
  // ticked as they are met, a strength meter, show/hide, a second entry to
  // catch typos, and a Generate button for those who would rather not invent
  // one. With requireSaved (the backup password, which nobody can recover for
  // them) the owner must also tick "I saved this password" first.
  //
  // `valid` is an output: the parent binds it to enable its submit button.
  let {
    value = $bindable(''),
    valid = $bindable(false),
    min,
    label,
    explain,
    confirm = true,
    requireSaved = false,
    disabled = false,
  }: {
    value?: string
    valid?: boolean
    min: number
    label: string
    explain?: Snippet
    confirm?: boolean
    requireSaved?: boolean
    disabled?: boolean
  } = $props()

  let again = $state('')
  let shown = $state(false)
  let saved = $state(false)
  let copied = $state(false)
  const id = `pw-${Math.random().toString(36).slice(2, 9)}`

  const longEnough = $derived([...value].length >= min)
  const oneLine = $derived(!/[\r\n\0]/.test(value))
  const matches = $derived(!confirm || (again !== '' && again === value))

  // 0–4, rough on purpose: length counts most, mixing kinds of characters a bit.
  const strength = $derived.by(() => {
    if (!value) return 0
    const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(value)).length
    const len = [...value].length
    let s = len >= min ? 1 : 0
    if (len >= Math.max(min, 12)) s++
    if (len >= Math.max(min + 4, 16)) s++
    if (kinds >= 3 || len >= 24) s++
    return Math.min(s, 4)
  })
  const strengthLabel = $derived(
    [m.password_strength_0(), m.password_strength_1(), m.password_strength_2(), m.password_strength_3(), m.password_strength_4()][strength],
  )

  $effect(() => {
    valid = longEnough && oneLine && matches && (!requireSaved || saved)
  })

  // Five groups of four from an alphabet without look-alikes (no 0/o, 1/l/i):
  // ~99 bits, easy to read back and to copy by hand.
  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
  function generate() {
    const bytes = new Uint8Array(20)
    const out: string[] = []
    while (out.length < 20) {
      crypto.getRandomValues(bytes)
      for (const b of bytes) {
        // Reject the top of the range so every character is equally likely.
        if (b < 256 - (256 % ALPHABET.length) && out.length < 20) out.push(ALPHABET[b % ALPHABET.length])
      }
    }
    value = out.join('').match(/.{4}/g)!.join('-')
    again = value
    shown = true
    saved = false
    copied = false
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      copied = true
    } catch {
      copied = false
    }
  }
</script>

<div class="pwfield">
  <label class="field" for={id}>
    <span>{label} {#if explain}{@render explain()}{/if}</span>
  </label>
  <div class="entry">
    <input
      {id}
      type={shown ? 'text' : 'password'}
      bind:value
      autocomplete="new-password"
      autocapitalize="off"
      spellcheck="false"
      {disabled}
      required
    />
    <button type="button" class="link" onclick={() => (shown = !shown)} aria-pressed={shown}>{shown ? m.password_hide() : m.password_show()}</button>
  </div>
  <div class="tools">
    <button type="button" class="link" onclick={generate} {disabled}>{m.password_generate()}</button>
    {#if value && shown}<button type="button" class="link" onclick={copy}>{copied ? m.copied() : m.copy()}</button>{/if}
  </div>

  <div class="meter" aria-hidden="true"><span class="s{strength}" style:width={`${strength * 25}%`}></span></div>
  <p class="hint">{m.password_strength({ level: strengthLabel })}</p>

  <ul class="rules">
    <li class:met={longEnough}>{m.password_rule_length({ min })}</li>
    {#if confirm}<li class:met={matches}>{m.password_rule_match()}</li>{/if}
  </ul>

  {#if confirm}
    <label class="field">
      {m.password_again()}
      <input type={shown ? 'text' : 'password'} bind:value={again} autocomplete="new-password" autocapitalize="off" spellcheck="false" {disabled} required />
      {#if again !== '' && again !== value}<span class="hint error">{m.onboarding_mismatch()}</span>{/if}
    </label>
  {/if}

  {#if requireSaved}
    <label class="check saved">
      <input type="checkbox" bind:checked={saved} {disabled} />
      <span>{m.password_saved()}</span>
    </label>
  {/if}
</div>

<style>
  .pwfield {
    display: grid;
    gap: 0.45rem;
  }
  .entry {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .entry input {
    flex: 1;
    min-width: 0;
  }
  .tools {
    display: flex;
    gap: 1rem;
    font-size: 0.85rem;
  }
  .meter {
    height: 6px;
    border-radius: 999px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    transition: width 0.15s;
    background: var(--bad-fg);
  }
  .meter .s2 {
    background: var(--warn-fg);
  }
  .meter .s3,
  .meter .s4 {
    background: var(--ok-fg);
  }
  .hint {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .rules {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .rules li::before {
    content: '○ ';
  }
  .rules li.met {
    color: var(--ok-fg);
  }
  .rules li.met::before {
    content: '✓ ';
  }
  .saved {
    background: var(--warn-bg);
    color: var(--warn-fg);
    border-radius: 10px;
    padding: 0.55rem 0.75rem;
  }
</style>
