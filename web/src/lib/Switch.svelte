<script lang="ts">
  // An on/off switch for a feature. `checked` is the host's answer, never an
  // optimistic guess: the parent flips it only once the request succeeded.
  let {
    checked,
    disabled = false,
    label,
    onchange,
  }: { checked: boolean | null; disabled?: boolean; label: string; onchange: (next: boolean) => void } = $props()
</script>

<button
  type="button"
  role="switch"
  class="switch"
  class:on={checked === true}
  aria-checked={checked === true}
  aria-label={label}
  disabled={disabled || checked === null}
  onclick={() => onchange(!checked)}
>
  <span class="knob"></span>
</button>

<style>
  .switch {
    width: 2.9rem;
    height: 1.6rem;
    padding: 0;
    border-radius: 999px;
    background: var(--border-strong);
    border: none;
    position: relative;
    flex: none;
    transition: background 0.15s;
  }
  .switch:hover:not(:disabled) {
    background: var(--text-subtle);
  }
  .switch.on,
  .switch.on:hover:not(:disabled) {
    background: var(--primary);
  }
  .knob {
    position: absolute;
    top: 0.2rem;
    left: 0.2rem;
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .on .knob {
    transform: translateX(1.3rem);
  }
</style>
