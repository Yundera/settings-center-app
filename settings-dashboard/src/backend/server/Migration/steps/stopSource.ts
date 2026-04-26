import { execOnSource, MigrationKeyPair, shq } from '../MigrationSSH';

/**
 * Stop source PCS:
 *   1. Bring down every docker-compose stack under /DATA/AppData.
 *   2. Disable the self-check cron so source can't rotate USER_JWT while
 *      target is being brought up. The cron is identified via crontab -l
 *      matching the yundera self-check marker path.
 *
 * Critical: if this step succeeds but a later step fails, rollback must
 * call restartSource() to bring source back to a serving state.
 */

const CRON_MARKER_FILE = '/DATA/AppData/casaos/apps/yundera/.self-check-cron-disabled';

export async function stopSource(keypair: MigrationKeyPair, host: string): Promise<void> {
    // 1. Find and bring down all compose stacks
    const bringDownScript = `
set +e
for compose_file in $(sudo -n find /DATA/AppData -maxdepth 4 -type f \\( -name 'docker-compose.yml' -o -name 'compose.yml' -o -name 'docker-compose.yaml' \\) 2>/dev/null); do
  dir=$(dirname "$compose_file")
  echo "Stopping stack: $dir"
  sudo -n docker compose -f "$compose_file" down --remove-orphans 2>&1 | tail -5
done
echo DONE
`.trim();

    await execOnSource(keypair, host, `bash -c ${shq(bringDownScript)}`, { timeout: 10 * 60 * 1000 });

    // 2. Disable self-check cron. The self-check is typically installed
    //    via cron — we remove any crontab line referencing the yundera
    //    self-check path, and drop a marker file so restart can undo it.
    //
    //    We look at both the operator's crontab AND root's crontab.
    const disableCronScript = `
set +e
MARKER=${shq(CRON_MARKER_FILE)}
sudo -n mkdir -p "$(dirname "$MARKER")"

# Save original crontabs so we can restore them on rollback
for who in root "$USER"; do
  backup="$MARKER.$who.bak"
  if sudo -n crontab -l -u "$who" 2>/dev/null > "/tmp/ct.$who" && [ -s "/tmp/ct.$who" ]; then
    sudo -n cp "/tmp/ct.$who" "$backup"
    grep -v 'yundera.*self-check' "/tmp/ct.$who" > "/tmp/ct.$who.new" || true
    sudo -n crontab -u "$who" "/tmp/ct.$who.new" 2>/dev/null || true
    rm -f "/tmp/ct.$who" "/tmp/ct.$who.new"
  fi
done

# Also disable any systemd timer matching yundera
for unit in $(sudo -n systemctl list-timers --all --no-legend 2>/dev/null | grep -i yundera | awk '{print $NF}'); do
  sudo -n systemctl stop "$unit" 2>/dev/null || true
  sudo -n systemctl disable "$unit" 2>/dev/null || true
  echo "$unit" >> "$MARKER.timers"
done

sudo -n touch "$MARKER"
echo DONE
`.trim();

    await execOnSource(keypair, host, `bash -c ${shq(disableCronScript)}`, { timeout: 60_000 });
}

/**
 * Rollback helper: bring source back to a running state.
 *   1. Restore self-check cron from backups.
 *   2. Bring every compose stack back up.
 */
export async function restartSource(keypair: MigrationKeyPair, host: string): Promise<void> {
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

    await execOnSource(keypair, host, `bash -c ${shq(restoreCronScript)}`, { timeout: 60_000 });

    const bringUpScript = `
set +e
for compose_file in $(sudo -n find /DATA/AppData -maxdepth 4 -type f \\( -name 'docker-compose.yml' -o -name 'compose.yml' -o -name 'docker-compose.yaml' \\) 2>/dev/null); do
  dir=$(dirname "$compose_file")
  echo "Starting stack: $dir"
  sudo -n docker compose -f "$compose_file" up -d 2>&1 | tail -5
done
echo DONE
`.trim();

    await execOnSource(keypair, host, `bash -c ${shq(bringUpScript)}`, { timeout: 10 * 60 * 1000 });
}
