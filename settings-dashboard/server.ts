import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import {start} from "@/backend/server";
import {initializeAllContexts} from "@/backend/server/initializeAllContexts";
import { handleTerminalUpgrade } from "@/backend/server/Terminal/TerminalHandler";
import { applyAuthGate } from "@/backend/auth/serverGate";

// Environment comes from the container env only. There used to be an
// initializeEnvironment() here that dotenv-loaded
// /DATA/AppData/casaos/apps/yundera/{.pcs.env,.pcs.secret.env,.ynd.user.env} —
// host paths that do not exist inside this container (the stack dir is bind-
// mounted at /app/data), so every call was a silent no-op. Both the prod
// template and the dev harness inject the assembled .env via compose
// `env_file:` instead; that is the supported path.

const dev = process.env.NODE_ENV !== 'production'
// Allow overriding the dev bind address — by default Next.js dev mode only
// listens on loopback, which breaks reverse-proxy containers that reach the
// admin app over a docker network.
const hostname = process.env.HOSTNAME_BIND ?? (dev ? 'localhost' : '0.0.0.0')
const port = dev ? 4342 : 80

// Create Next.js app instance
const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(async () => {
    const server = createServer(async (req, res) => {
        const parsedUrl = parse(req.url!, true)
        const pathname = parsedUrl.pathname || '/'

        // Gate every page request behind a valid session cookie before Next.js
        // ever sees it. Bypass list is in serverGate.ts (login chooser, public
        // APIs, static assets). This is what kills the "401 storm before
        // Authelia redirect" problem — the SPA can't mount unauthenticated.
        if (await applyAuthGate(req, res, pathname)) return

        // Handle all routes with Next.js
        handle(req, res, parsedUrl)
    })

    // Terminal panel WebSocket. Once any `upgrade` listener is attached,
    // Node no longer auto-closes unmatched upgrade requests, so we must
    // destroy the socket ourselves for anything that isn't our endpoint.
    server.on('upgrade', (req, socket, head) => {
        if (handleTerminalUpgrade(req, socket, head)) return;
        socket.destroy();
    });

    await initializeAllContexts();

    // Start background tasks (don't await this)
    start().then(() => {
        console.log('Background tasks started successfully')
    }).catch((error) => {
        console.error('Error starting background tasks:', error)
    });

    server.listen(port, hostname, () => {
        console.log('####################################################');
        console.log(`> Server ready on http://${hostname}:${port}`)
        console.log(`> Environment: ${dev ? 'development' : 'production'}`)
        console.log('####################################################');
    })
}).catch((error) => {
    console.error('Error starting server:', error)
    process.exit(1)
});