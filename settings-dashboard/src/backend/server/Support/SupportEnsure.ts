import { executeHostCommand } from "@/backend/cmd/HostExecutor";

/**
 * Reads / writes the durable opt-out flag for the support-key safety net.
 *
 * The flag lives in /DATA/AppData/casaos/apps/yundera/.pcs.env as
 * ENSURE_SUPPORT_KEY. Polarity:
 *   absent / "true" / "1" / "yes" / "on" → ensure (default)
 *   "false" / "0" / "no" / "off"          → opt-out
 *
 * The host-side self-check ensure-yundera-support-key.sh consumes the
 * same key on every tick. The dashboard handles the immediate add/remove
 * via SupportAccess.ts; this module just persists the durable intent.
 */

const PCS_ENV = "/DATA/AppData/casaos/apps/yundera/.pcs.env";
const ENV_MGR = "/DATA/AppData/casaos/apps/yundera/scripts/tools/env-file-manager.sh";

function isOptedOut(raw: string): boolean {
    const v = raw.trim().toLowerCase();
    return v === "false" || v === "0" || v === "no" || v === "off";
}

export async function getEnsureSupportKey(): Promise<{ ensure: boolean; rawValue: string }> {
    const result = await executeHostCommand(`sudo -n bash ${ENV_MGR} get ENSURE_SUPPORT_KEY ${PCS_ENV}`);
    const raw = (result.stdout || "").trim();
    return { ensure: !isOptedOut(raw), rawValue: raw };
}

export async function setEnsureSupportKey(ensure: boolean): Promise<{ ensure: boolean; rawValue: string }> {
    const value = ensure ? "true" : "false";
    await executeHostCommand(`sudo -n bash ${ENV_MGR} set ENSURE_SUPPORT_KEY ${value} ${PCS_ENV}`);
    return { ensure, rawValue: value };
}
