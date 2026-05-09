import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { shq } from '../MigrationSSH';

/**
 * Stop THIS PCS (the source) before the offline diff rsync, so its data
 * is quiescent and so its self-check cron can't rotate USER_JWT or restart
 * apps while the target is being brought up:
 *   1. Bring down every docker-compose stack under /DATA/AppData.
 *   2. Disable the local self-check cron (keeping a backup so we can restore
 *      it on rollback). Removes any matching crontab line on root + the
 *      operator user, plus any yundera systemd timer.
 *
 * If a later step fails, rollback calls restartSource() to bring this PCS
 * back to a serving state.
 */

const CRON_MARKER_FILE = '/DATA/AppData/casaos/apps/yundera/.self-check-cron-disabled';

// The compose stack that hosts the migration's own infrastructure (admin
// app, mesh-router, auth-registrar, etc.). Excluded from stop_source's
// teardown — bringing it down would: (1) kill the admin process driving
// this migration, (2) drop the source's mesh-router so the user's domain
// stops resolving mid-cutover. The source VPS as a whole is destroyed
// later by the orchestrator's pool reaper after promotion + GRACE_MINUTES,
// not by this pipeline.
const SYSTEM_STACK_PATH = '/DATA/AppData/casaos/apps/yundera/';

export async function stopSource(): Promise<void> {
    // 1. Bring down every USER compose stack (excluding the yundera system
    //    stack — see SYSTEM_STACK_PATH note above).
    const bringDownScript = `
set +e
for compose_file in $(sudo -n find /DATA/AppData -maxdepth 4 -type f \\( -name 'docker-compose.yml' -o -name 'compose.yml' -o -name 'docker-compose.yaml' \\) 2>/dev/null | grep -v ${shq(SYSTEM_STACK_PATH)}); do
  dir=$(dirname "$compose_file")
  echo "Stopping stack: $dir"
  sudo -n docker compose -f "$compose_file" down --remove-orphans 2>&1 | tail -5
done
echo DONE
`.trim();
    await executeHostCommand(`bash -c ${shq(bringDownScript)}`, { timeout: 10 * 60 * 1000 });

    // 2. Disable self-check cron (backup so rollback can restore)
    const disableCronScript = `
set +e
MARKER=${shq(CRON_MARKER_FILE)}
sudo -n mkdir -p "$(dirname "$MARKER")"

for who in root "$USER"; do
  backup="$MARKER.$who.bak"
  if sudo -n crontab -l -u "$who" 2>/dev/null > "/tmp/ct.$who" && [ -s "/tmp/ct.$who" ]; then
    sudo -n cp "/tmp/ct.$who" "$backup"
    grep -v 'yundera.*self-check' "/tmp/ct.$who" > "/tmp/ct.$who.new" || true
    sudo -n crontab -u "$who" "/tmp/ct.$who.new" 2>/dev/null || true
    rm -f "/tmp/ct.$who" "/tmp/ct.$who.new"
  fi
done

for unit in $(sudo -n systemctl list-timers --all --no-legend 2>/dev/null | grep -i yundera | awk '{print $NF}'); do
  sudo -n systemctl stop "$unit" 2>/dev/null || true
  sudo -n systemctl disable "$unit" 2>/dev/null || true
  echo "$unit" >> "$MARKER.timers"
done

sudo -n touch "$MARKER"
echo DONE
`.trim();
    await executeHostCommand(`bash -c ${shq(disableCronScript)}`, { timeout: 60_000 });
}

/**
 * Rollback helper: bring THIS PCS back to a running state.
 *   1. Restore self-check cron from backups.
 *   2. Bring every compose stack back up.
 */
export async function restartSource(): Promise<void> {
    const restoreCronScript = `
set +e
MARKER=${shq(CRON_MARKER_FILE)}
for who in root "$USER"; do
  backup="$MARKER.$who.bak"
  if sudo -n test -s "$backup"; then
    sudo -n crontab -u "$who" "$backup" 2>/dev/null || true
  fi
done
if sudo -n test -f "$MARKER.timers"; then
  while read -r unit; do
    sudo -n systemctl enable "$unit" 2>/dev/null || true
    sudo -n systemctl start "$unit" 2>/dev/null || true
  done < <(sudo -n cat "$MARKER.timers")
fi
sudo -n rm -f "$MARKER" "$MARKER".*.bak "$MARKER.timers"
echo DONE
`.trim();
    await executeHostCommand(`bash -c ${shq(restoreCronScript)}`, { timeout: 60_000 });

    // Symmetric to stopSource: only restart USER stacks. The yundera
    // system stack was never stopped, so don't try to "restart" it (a
    // `compose up -d` is harmless if already up, but skip for symmetry
    // and to avoid touching the migration's own host environment).
    const bringUpScript = `
set +e
for compose_file in $(sudo -n find /DATA/AppData -maxdepth 4 -type f \\( -name 'docker-compose.yml' -o -name 'compose.yml' -o -name 'docker-compose.yaml' \\) 2>/dev/null | grep -v ${shq(SYSTEM_STACK_PATH)}); do
  dir=$(dirname "$compose_file")
  echo "Starting stack: $dir"
  sudo -n docker compose -f "$compose_file" up -d 2>&1 | tail -5
done
echo DONE
`.trim();
    await executeHostCommand(`bash -c ${shq(bringUpScript)}`, { timeout: 10 * 60 * 1000 });
}
