import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import {start} from "@/backend/server";
import {initializeAllContexts} from "@/backend/server/initializeAllContexts";

const dev = process.env.NODE_ENV !== 'production'
const hostname = dev ? 'localhost' : '0.0.0.0'
const port = dev ? 4342 : 80

// Create Next.js app instance
const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(async () => {
    const server = createServer((req, res) => {
        const parsedUrl = parse(req.url!, true)

        // Handle all routes with Next.js
        handle(req, res, parsedUrl)
    })

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