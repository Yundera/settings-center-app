import { NextApiRequest, NextApiResponse } from 'next';
import nodemailer from 'nodemailer';
import { gzipSync } from 'zlib';
import { authMiddleware } from "@/backend/auth/middleware";
import { executeHostCommand } from "@/backend/cmd/HostExecutor";
import { getConfig } from "@/configuration/getConfigBackend";
import { enableSupportAccess } from "@/backend/server/Support/SupportAccess";

const LOG_FILE = "/DATA/AppData/casaos/apps/yundera/log/yundera.log";
const MAX_LOG_LINES = 5000;
const MAX_SUBJECT_LEN = 200;
const MAX_MESSAGE_LEN = 10000;

interface ReportRequest {
    subject: string;
    message: string;
    includeLog: boolean;
    grantAccess: boolean;
}

async function readLogTail(lines: number): Promise<string> {
    const result = await executeHostCommand(`tail -n ${lines} ${LOG_FILE} 2>/dev/null || true`);
    return result.stdout || '';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = (req.body || {}) as Partial<ReportRequest>;
    const subject = (body.subject || '').toString().trim();
    const message = (body.message || '').toString().trim();
    const includeLog = body.includeLog !== false;
    const grantAccess = body.grantAccess === true;

    if (!subject || subject.length > MAX_SUBJECT_LEN) {
        return res.status(400).json({ error: `Subject required (1–${MAX_SUBJECT_LEN} chars)` });
    }
    if (!message || message.length > MAX_MESSAGE_LEN) {
        return res.status(400).json({ error: `Message required (1–${MAX_MESSAGE_LEN} chars)` });
    }

    const supportEmail = getConfig('SUPPORT_EMAIL') || 'support@yundera.com';
    const smtpHost = getConfig('SMTP_HOST') || 'smtp';
    const smtpPort = parseInt(getConfig('SMTP_PORT') || '587', 10);
    const domain = getConfig('DOMAIN') || 'unknown-pcs';
    const uid = getConfig('UID') || 'unknown';

    let accessSummary = 'Support access: NOT GRANTED.';
    let accessFingerprint: string | null = null;
    if (grantAccess) {
        try {
            const result = await enableSupportAccess();
            accessFingerprint = result.key.fingerprint;
            accessSummary = result.status === 'added'
                ? `Support access: GRANTED (fingerprint ${result.key.fingerprint}).`
                : `Support access: ALREADY GRANTED (fingerprint ${result.key.fingerprint}).`;
        } catch (err) {
            accessSummary = `Support access: REQUESTED but failed — ${err instanceof Error ? err.message : String(err)}`;
        }
    }

    const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
    let logSummary = 'Log attached: no.';
    if (includeLog) {
        try {
            const log = await readLogTail(MAX_LOG_LINES);
            if (log) {
                const gz = gzipSync(Buffer.from(log, 'utf8'));
                attachments.push({
                    filename: 'yundera.log.gz',
                    content: gz,
                    contentType: 'application/gzip',
                });
                logSummary = `Log attached: yundera.log.gz (last ${MAX_LOG_LINES} lines, ${gz.length} bytes gzipped).`;
            } else {
                logSummary = 'Log attached: no (log file empty or unreadable).';
            }
        } catch (err) {
            logSummary = `Log attached: no (error reading log — ${err instanceof Error ? err.message : String(err)}).`;
        }
    }

    const userInfo = (req as any).user || {};
    const reporter = userInfo.uid || userInfo.email || 'unknown';

    const fullText = [
        `From: ${reporter}`,
        `PCS: ${domain} (UID ${uid})`,
        accessSummary,
        logSummary,
        '',
        '— User message —',
        message,
    ].join('\n');

    try {
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: false,
            tls: { rejectUnauthorized: false },
            ignoreTLS: smtpPort === 25,
        });

        await transporter.sendMail({
            from: `"PCS ${domain}" <noreply@${domain}>`,
            to: supportEmail,
            subject: `[PCS Support] ${subject}`,
            text: fullText,
            attachments,
        });

        res.status(200).json({
            sent: true,
            to: supportEmail,
            grantedAccess: grantAccess && !!accessFingerprint,
            fingerprint: accessFingerprint,
        });
    } catch (error) {
        res.status(502).json({
            error: 'Failed to send support email',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
