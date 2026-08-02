Example `config/core.env.json`. The real file is gitignored (`config/*.json`) and
is NOT shipped in the image — on a PCS every key below comes from the container
environment instead (template-root assembles `.env`, compose injects it with
`env_file:`). `getConfig()` reads `process.env` first, this file second.

```json
{

"BASE_PATH": "/",
"COMPOSE_FOLDER_PATH":"/DATA/AppData/casaos/apps/yundera/",
"OIDC_REGISTRAR_URL":"http://auth-registrar:9092/register",

"FRONTEND_PUBLIC_ENV":["BASE_PATH"]

}
```

`FRONTEND_PUBLIC_ENV` is a **publication list**, not documentation: every key in
it is served verbatim by `GET /api/core/config/core` onto `window.APP_CONFIG` in
the browser. The frontend reads exactly one key — `BASE_PATH`
(`src/configuration/getConfigFrontEnd.ts`) — so keep the list at that. It used to
also carry `PROVIDER_STR`, `DEFAULT_PWD` and `UID`, which would push PCS secrets
into the page for any logged-in session; the panels that display those values
fetch them through the authenticated `/api/admin/get-environment` instead.

No `JWT_SECRET`: the admin session cookie and the OIDC state cookie are signed
with a key the app persists itself at `/app/data/admin-session-key`
(`src/backend/auth/sessionKey.ts`), so restarts don't sign anyone out. Override
in dev with `SESSION_KEY` (base64) or `SESSION_KEY_PATH`.
