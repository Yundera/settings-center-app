<script lang="ts">
  import Pill from './Pill.svelte'
  import type { Level } from './api'
  import { m } from './paraglide/messages.js'

  let { level }: { level: Level } = $props()
  const tone = $derived(level === 'unknown' ? 'neutral' : level)
  const text = $derived(
    {
      ok: m.level_ok(),
      info: m.level_info(),
      warn: m.level_warn(),
      bad: m.level_bad(),
      unknown: m.level_unknown(),
    }[level],
  )
</script>

<Pill {tone}>{text}</Pill>
