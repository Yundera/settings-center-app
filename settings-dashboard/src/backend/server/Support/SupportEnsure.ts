import { executeHostCommand } from "@/backend/cmd/HostExecutor";
import { yndPath } from "@/configuration/yndRoot";

/**
 * Reads the durable opt-out flag for the support-key safety net.
 *
 * The flag lives in the stack's `.pcs.env` (see `yndRoot()`) as
 * ENSURE_SUPPORT_KEY. Polarity:
 *   absent / "true" / "1" / "yes" / "on" → ensure (default)
 *   "false" / "0" / "no" / "off"          → opt-out
 *
 * The host-side self-check ensure-support-key.sh consumes the same key on
 * every tick.
 *
 * READ ONLY. Writing the flag belongs to feature-support-key.sh via
 * Features.ts, which also removes the key from authorized_keys in the same
 * step — "off" that leaves the key on disk is a lie, and one implementation of
 * that is enough. What survives here is the half the script does not do:
 * reporting the stored intent so a caller can show it next to the live key
 * presence from SupportAccess.ts and flag a divergence.
 */

const PCS_ENV = yndPath(".pcs.env");
const ENV_MGR = yndPath("scripts/tools/env-file-manager.sh");

function isOptedOut(raw: string): boolean {
    const v = raw.trim().toLowerCase();
    return v === "false" || v === "0" || v === "no" || v === "off";
}

export async function getEnsureSupportKey(): Promise<{ ensure: boolean; rawValue: string }> {
    const result = await executeHostCommand(`sudo -n bash ${ENV_MGR} get ENSURE_SUPPORT_KEY ${PCS_ENV}`);
    const raw = (result.stdout || "").trim();
    return { ensure: !isOptedOut(raw), rawValue: raw };
}
