import {getConfig} from "@/configuration/getConfigBackend";

/**
 * Base URL of the operator's control plane (the orchestrator).
 *
 * Two env names, one value. `OPERATOR_API` is the name; `YUNDERA_API` is what
 * it was called before the support surface was unbranded, and it is still what
 * a PCS provides until `2026-08-04-11-rename-yundera-api.sh` has run and the
 * admin container has been recreated from the new compose. Reading both keeps
 * the Support panel working across that window, in either order.
 *
 * The alias can go once no fleet host predates the rename — grep for
 * YUNDERA_API; the template compose feeds both names from the same value, so
 * dropping it is a one-line change here plus the compose entry.
 */
export function operatorApi(): string {
    return getConfig("OPERATOR_API") || getConfig("YUNDERA_API") || "";
}
