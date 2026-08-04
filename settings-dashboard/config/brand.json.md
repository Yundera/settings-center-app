# `brand.json` — per-stack branding

The admin app ships as **one image serving two stacks**: managed Yundera PCS boxes,
and the self-hosted mesh stack installed by `mesh-router-template-root/install.sh`.
`brand.json` is what decides which one a given box renders as.

Absent an override, the baked default reproduces Yundera's appearance exactly.

## Where it lives

| | |
|---|---|
| **Baked default** | `src/brand/brand.default.json`, statically imported — always present |
| **Override** | `/app/data/brand.json` |
| **Escape hatch** | `$BRAND_CONFIG_PATH`, if set |

`/app/data` is the important one. The PCS stack directory
(`/DATA/AppData/casaos/apps/yundera/`, `COMPOSE_FOLDER_PATH`) is a **host** path —
it is only ever used to build strings for `executeHostCommand()`, i.e. commands run
on the host over SSH. It is not readable from inside this container. The stack dir
is bind-mounted here at `/app/data`, so that is where a stack drops its override.

To brand a stack: write `brand.json` into the stack directory on the host. It shows
up inside the container at `/app/data/brand.json` with no compose change.

## Schema

```jsonc
{
  "schemaVersion": 1,                    // must be 1, else the override is ignored wholesale
  "brand": {
    "name":        "Yundera",            // interpolated into UI copy
    "appTitle":    "Settings",           // app-bar + login-page title
    "logo":        "/logo-nasselle-V1.svg",
    "logFileName": "yundera.log"         // DISPLAY ONLY — see caveat below
  },
  "operator": {                          // null ⇒ self-hosted, see below
    "name":           "Yundera",
    "dashboardUrl":   "https://app.yundera.com/dashboard",
    "dashboardLabel": "Yundera Dashboard",
    "panelLabel":     "Operator",        // sidebar label for the Operator panel
    "support":        { "enabled": true },
    "trustedPubkeyHostSuffixes": ["yundera.com"],
    "accountUrl":     "https://…"        // OPTIONAL; adds an Account-panel card
  },
  "domainProviders": {                   // keyed by the server-domain half of DOMAIN
    "nsl.sh": {
      "label": "nsl.sh", "dashboardLabel": "nsl.sh",
      "panelLabel": "Operator", "dashboardUrl": "https://nsl.sh"
    }
  }
}
```

### Merge rules

| Key | Behaviour |
|---|---|
| `brand` | shallow-merged, so an override can set only `name` |
| `domainProviders` | merged **by key** — add a zone without restating the others |
| `operator` | **replaced wholesale**, never merged. A half-specified operator (name but no `dashboardUrl`) renders a panel with a dead link — worse than none |

`"operator": null` explicitly means *no operator*. An **absent** `operator` key
inherits the default, which is Yundera's. That distinction is deliberate: a
self-hosted box must state `null`, not just omit it.

### `logo` must start with `/logo`

`serverGate.ts` bypasses the `/logo` prefix for unauthenticated requests, and the
login page is unauthenticated. A logo outside that prefix gets 302'd to `/login` and
renders broken. Enforced by `LOGO_PATTERN` in `loadBrandFile.ts` — a violating value
is rejected with a warning and the default logo is used.

**Logos are baked into the image**, served from `settings-dashboard/public/`.
Currently shipped: `logo-nasselle-V1.svg` (Yundera) and `logo-mesh.webp` (mesh).
A brand needing a different mark needs it added to `public/` and a new image build —
pointing `brand.json` at a file that isn't there yields a broken image, not a
fallback.

## The Operator panel

One optional sidebar page whose entire content is "who runs this box, and where their
dashboard is". It is **deliberately agnostic about what that dashboard does** —
subscriptions, invoices, VM controls or none of the above are the operator's business.
The app used to call this page "Billing" and assert that subscriptions were managed
there; that assumption is gone, so an operator that never bills anyone renders the same
panel. Name it via `panelLabel`.

### The two axes: operator vs domain provider

These are **independent**, and conflating them is the mistake this config exists to
prevent.

- **Operator** — who runs the box. Requires `operator` non-null in `brand.json`
  **AND** `YUNDERA_API` set in the environment. Both, because the baked default
  carries Yundera's operator block: a self-hosted box that forgot its `brand.json`
  would otherwise render a Support panel whose every call throws.
- **Domain provider** — which zone the domain sits in (`nsl.sh`, `inojob.com`),
  derived from `DOMAIN`. Feeds the same panel when there is no operator.

**The configured operator always wins the dashboard link.** A Yundera customer whose
domain is `yunderalabs.nsl.sh` is operated by Yundera, so they are sent to Yundera's
dashboard — not nsl.sh's.

```
operator = operator ?? domainProviders[serverDomain] ?? null   // null ⇒ hide the panel
```

`BrandPayload.hasOperator` stays a separate boolean: it is true only for a *configured*
operator, never for the domain-zone fallback, so a link and a vouched-for operator are
never confused.

### What `operator: null` turns off

1. **Support panel disappears** from the sidebar entirely — it is an operator-only
   surface, and without one every call in `SupportKey.ts` throws.
2. **Operator panel** falls back to the domain provider, or disappears too if the
   zone is unrecognised.
3. **`trustedPubkeyHostSuffixes` is empty** — fetched SSH keys all render in the
   neutral "TLS-verified" tone rather than "Trusted source". With nobody to vouch
   for a host, nothing is official.

## Self-hosted example

```json
{
  "schemaVersion": 1,
  "brand": {
    "name": "Mesh",
    "appTitle": "Settings",
    "logo": "/logo-mesh.webp",
    "logFileName": "mesh.log"
  },
  "operator": null
}
```

Note it omits `domainProviders` — that table is not Yundera-specific and is
inherited from the default.

## How it reaches the UI

`GET /api/brand` serves a **pre-resolved** payload; it is in `BYPASS_PREFIXES`
(`serverGate.ts`) because the login page needs the logo before a session exists.

> **Security invariant.** That route is unauthenticated. `DOMAIN` and `YUNDERA_API`
> are consumed server-side and reduced to a link plus a boolean before anything
> crosses the wire. **Nothing from `.pcs.secret.env` may ever be added to
> `BrandPayload`.** See `core.env.json.md` on why `PROVIDER_STR` / `DEFAULT_PWD` /
> `UID` were removed from `FRONTEND_PUBLIC_ENV` — the same rule applies here with
> less protection, because there is no session gate.

Consumers:

- **React-admin tree** — `brandContext.ts` fetches it inside the `providers()`
  callback `AppLoader` awaits, so panels read a settled value synchronously.
  `loadBrand()` never rejects: on failure the UI keeps the baked default rather
  than parking on a spinner forever.
- **Login page** — an RSC, so it calls `resolveBrand()` directly. No fetch, no flash.

Edits to `brand.json` are picked up within ~10s (mtime-checked cache in
`loadBrandFile.ts`) — no container restart.

## Caveat: `logFileName` is display-only

It changes the label in the Support panel, not where the backend reads. The real
path is still hardcoded in `support-send-report.ts` and friends pending the
`PCS_LOG_FILE` / `COMPOSE_FOLDER_PATH` work (Phase 4 of the mesh template's
`alignment-with-template-root.md`). Unreachable today — the Support panel is hidden
without an operator — but the two must land together.
