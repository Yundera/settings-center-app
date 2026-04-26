/**
 * Fire a one-shot webhook at the end of a migration (success or failure).
 * Fire-and-forget: a dead webhook does not mark the migration as failed.
 * HTTPS only — we treat the URL as untrusted user input.
 */

export interface WebhookPayload {
    status: 'success' | 'failed';
    error?: string;
    startedAt?: Date;
}

const TIMEOUT_MS = 5_000;

export async function fireWebhook(url: string, payload: WebhookPayload): Promise<void> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid webhook URL: ${url}`);
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(`Webhook URL must be HTTPS, got ${parsed.protocol}`);
    }

    const body = JSON.stringify({
        status: payload.status,
        error: payload.error,
        startedAt: payload.startedAt?.toISOString(),
        finishedAt: new Date().toISOString(),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal,
            redirect: 'manual',
        });
    } finally {
        clearTimeout(timer);
    }
}
