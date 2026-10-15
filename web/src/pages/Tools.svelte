<script lang="ts">
  import Card from '../lib/Card.svelte'
  import type { Me } from '../lib/api'
  import { m } from '../lib/paraglide/messages.js'

  // Where everything else lives. Each part of the server has its own page;
  // this one says what each is for, in the owner's words, so they know where
  // to go before they need to.
  let { me }: { me: Me } = $props()
  const l = $derived(me.links)
</script>

<div class="page-intro">
  <h1>{m.tools_title()}</h1>
  <p>{m.tools_intro()}</p>
</div>

<h2 class="section-title">{m.tools_group_apps()}</h2>
<Card>
  <div class="tool">
    <div>
      <h3>{m.tools_maison_title()}</h3>
      <p>{m.tools_maison_body()}</p>
      <p class="muted when">{m.tools_maison_when()}</p>
    </div>
    <a class="button primary" href={l.maison}>{m.tools_open()}</a>
  </div>
</Card>

<h2 class="section-title">{m.tools_group_backups()}</h2>
<p class="muted group-intro">{m.tools_backups_intro()}</p>
<div class="pair">
  <Card>
    <h3>{m.tools_backups_maison_title()} <span class="badge">{m.tools_start_here()}</span></h3>
    <p>{m.tools_backups_maison_body()}</p>
    <ul>
      <li>{m.tools_backups_maison_1()}</li>
      <li>{m.tools_backups_maison_2()}</li>
      <li>{m.tools_backups_maison_3()}</li>
    </ul>
    <a class="button primary" href={l.maisonBackups}>{m.tools_open_backups()}</a>
  </Card>
  <Card>
    <h3>{m.tools_backups_kopia_title()} <span class="badge muted-badge">{m.tools_advanced()}</span></h3>
    <p>{m.tools_backups_kopia_body()}</p>
    <ul>
      <li>{m.tools_backups_kopia_1()}</li>
      <li>{m.tools_backups_kopia_2()}</li>
      <li>{m.tools_backups_kopia_3()}</li>
    </ul>
    <a class="button" href={l.kopia}>{m.tools_open_kopia()}</a>
  </Card>
</div>
<Card>
  <p class="analogy"><strong>{m.tools_backups_analogy_title()}</strong> {m.tools_backups_analogy()}</p>
</Card>

<h2 class="section-title">{m.tools_group_access()}</h2>
<Card>
  <div class="tool">
    <div>
      <h3>{m.tools_accounts_title()}</h3>
      <p>{m.tools_accounts_body()}</p>
      <p class="muted when">{m.tools_accounts_when()}</p>
    </div>
    <div class="row">
      <a class="button primary" href={l.authConsole}>{m.tools_open()}</a>
      <a class="button" href={l.authAccess}>{m.tools_accounts_ssh()}</a>
    </div>
  </div>
</Card>

<h2 class="section-title">{m.tools_group_network()}</h2>
<Card>
  <div class="tool">
    <div>
      <h3>{m.tools_network_title()}</h3>
      <p>{m.tools_network_body()}</p>
      <p class="muted when">{m.tools_network_when()}</p>
    </div>
    <div class="row">
      <a class="button primary" href={l.meshConsole}>{m.tools_open()}</a>
      <a class="button" href={l.meshDomain}>{m.tools_network_domain()}</a>
    </div>
  </div>
</Card>

<h2 class="section-title">{m.tools_group_account()}</h2>
<Card>
  <div class="tool">
    <div>
      <h3>{m.tools_subscription_title()}</h3>
      <p>{m.tools_subscription_body()}</p>
    </div>
    <a class="button" href={l.dashboard} target="_blank" rel="noopener">{m.tools_open()}</a>
  </div>
</Card>

<style>
  h3 {
    margin: 0 0 0.35rem;
    font-size: 1.05rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  p {
    margin: 0 0 0.5rem;
  }
  .when {
    margin: 0;
    font-size: 0.85rem;
  }
  .tool {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .tool > div:first-child {
    flex: 1 1 22rem;
  }
  .group-intro {
    margin: -0.25rem 0 0.6rem;
    max-width: 72ch;
  }
  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  ul {
    margin: 0 0 0.9rem;
    padding-left: 1.2rem;
    color: var(--text-muted);
  }
  li {
    margin: 0.2rem 0;
  }
  .badge {
    font-family: var(--font-sans);
    font-size: 0.7rem;
    font-weight: 700;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: var(--ok-bg);
    color: var(--ok-fg);
  }
  .muted-badge {
    background: var(--surface-3);
    color: var(--text-muted);
  }
  .analogy {
    margin: 0;
  }
</style>
