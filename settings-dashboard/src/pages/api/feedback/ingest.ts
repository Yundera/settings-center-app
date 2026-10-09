import {NextApiRequest, NextApiResponse} from 'next';
import {hasBearer} from '@/backend/auth/bearer';
import {sendOperatorMail} from '@/backend/server/Support/operatorMail';
import {getConfig} from '@/configuration/getConfigBackend';
import {loadBrandFile} from '@/brand/loadBrandFile';

/**
 * The operator's feedback sink for Maison's "Send feedback" (Maison
 * docs/feedback.md). Maison calls it server-to-server over the pcs network —
 * http://admin-app/api/feedback/ingest — never through the AppShield gate, so no
 * session exists here: the bearer token (FEEDBACK_TOKEN, minted by template-root
 * and handed to both containers) is the authentication. It matters because every
 * container on pcs, including every installed store app, can reach this route.
 *
 *   GET  → the descriptor: who reads the feedback. 404 means "feature off", which
 *          is how a box with no operator, or one whose operator turned feedback
 *          off in brand.json, hides the menu entry in Maison.
 *   POST → mail it to the operator, the same way the Support panel mails a report.
 *
 * No log, no support access: feedback is about the product, support is about the
 * box, and only the latter may open a door into it.
 */
export const config = {api: {bodyParser: {sizeLimit: '32kb'}}};

const MAX_LENGTH = 5000;
const CATEGORIES = new Set(['idea', 'bug', 'other']);

/** Who reads feedback and where it is mailed, or null when the feature is off. */
function destination(): {operator: string; to: string; supportUrl?: string} | null {
    const operator = loadBrandFile().operator;
    if (!operator || operator.feedback?.enabled === false) return null;
    const to = getConfig('FEEDBACK_EMAIL') || operator.feedback?.email || operator.support.email || '';
    if (!to) return null;
    const domain = getConfig('DOMAIN');
    // The Support panel of this very app, when there is one to point at. Feedback
    // is not the place to ask for help with a broken box; that page is.
    const supportUrl = domain && operator.support.enabled ? `https://admin-${domain}/#/support` : undefined;
    return {operator: operator.name, to, supportUrl};
}

function str(v: unknown, max: number): string {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Cache-Control', 'no-store');

    // An unset token is the feature not deployed on this box — answer as if the
    // route did not exist, rather than 401 to a caller that has nothing to send.
    const token = getConfig('FEEDBACK_TOKEN');
    if (!token) return res.status(404).json({error: 'Feedback is not configured on this server'});
    if (!hasBearer(req, token)) return res.status(401).json({error: 'Unauthorized'});

    const dest = destination();
    if (!dest) return res.status(404).json({error: 'Feedback is turned off on this server'});

    if (req.method === 'GET') {
        return res.status(200).json({
            operator: dest.operator,
            privacyNote: `Read by the ${dest.operator} team. It includes this server's address so they can follow up.`,
            maxLength: MAX_LENGTH,
            ...(dest.supportUrl ? {supportUrl: dest.supportUrl} : {}),
        });
    }
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({error: 'Method not allowed'});
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const category = typeof body.category === 'string' && CATEGORIES.has(body.category) ? body.category : 'other';
    if (!message || [...message].length > MAX_LENGTH) {
        return res.status(400).json({error: `Message required (1–${MAX_LENGTH} characters)`});
    }
    const ctx = (body.context && typeof body.context === 'object' ? body.context : {}) as Record<string, unknown>;
    const source = str(ctx.source, 40) || 'unknown';
    const version = str(ctx.version, 40) || 'unknown';
    const page = str(ctx.page, 200);
    const appId = str(ctx.appId, 100);
    const reporter = str(body.reporter, 200);

    const domain = getConfig('DOMAIN') || 'unknown-pcs';
    const uid = getConfig('UID') || 'unknown';
    const firstLine = message.split('\n')[0];
    const summary = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;

    const text = [
        `PCS: ${domain} (UID ${uid})`,
        `From: ${reporter || 'not identified'}`,
        `Source: ${source} ${version}`,
        `Category: ${category}`,
        ...(page ? [`Page: ${page}`] : []),
        ...(appId ? [`App: ${appId}`] : []),
        '',
        '— Feedback —',
        message,
    ].join('\n');

    try {
        await sendOperatorMail({to: dest.to, subject: `[PCS Feedback] ${category}: ${summary}`, text});
        console.log(`[feedback] ${category} from ${source} ${version} mailed to the operator`);
        return res.status(202).json({sent: true});
    } catch (error) {
        console.error('[feedback] mail failed:', error);
        return res.status(502).json({error: 'Could not deliver your feedback right now — please try again later'});
    }
}
