import { executeHostCommand } from '@/backend/cmd/HostExecutor';
import { shq } from '../MigrationSSH';

/**
 * The cutover. Runs LOCAL on the source PCS, AFTER `start_user_apps` (the
 * destination is fully up and its mesh-router-agent is publishing) and
 * BEFORE `verify_destination`.
 *
 * `stop_source` (step 5) stopped the user app stacks but deliberately left
 * the `yundera` system stack up — `admin` (running this pipeline) and
 * `mesh-router` live there. While both the source's and the destination's
 * mesh-router-agent are up they fight over the single `domain → IP` record
 * in mesh-router-backend. This step ends that contention: it `docker compose
 * stop`s every service in the `yundera` system stack EXCEPT `admin`, so the
 * source's agent stops publishing and the destination owns the route
 * uncontested. `admin` stays up — it is still running this pipeline and is
 * the only remaining way status reaches the orchestrator (via the outbound
 * status push, which does not depend on the source's mesh-router).
 *
 * `stop` (not `down`) so a rollback is a plain `docker compose up -d`
 * (see restartSource() in stopSource.ts).
 *
 * See doc/architecture/migration.md — "Invariant 1".
 */

const SYSTEM_COMPOSE = '/DATA/AppData/casaos/apps/yundera/docker-compose.yml';

export async function deregisterSource(): Promise<void> {
    // Enumerate the system stack's services and stop every one except
    // `admin`. Passing an explicit service list to `docker compose stop`
    // matters: with no arguments it would stop ALL services, `admin`
    // included — which would kill this very pipeline.
    const script = `
set +e
COMPOSE=${shq(SYSTEM_COMPOSE)}
services=$(sudo -n docker compose -f "$COMPOSE" config --services 2>/dev/null | grep -vx 'admin')
if [ -z "$services" ]; then
  echo "no non-admin services found in the system stack — nothing to stop"
  echo DONE
  exit 0
fi
echo "Stopping system stack services (admin excluded): $(echo $services | tr '\\n' ' ')"
sudo -n docker compose -f "$COMPOSE" stop $services 2>&1 | tail -20
echo DONE
`.trim();
    await executeHostCommand(`bash -c ${shq(script)}`, { timeout: 5 * 60 * 1000 });
}
