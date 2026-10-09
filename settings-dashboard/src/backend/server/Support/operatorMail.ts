import nodemailer from 'nodemailer';
import {getConfig} from "@/configuration/getConfigBackend";

export interface OperatorMail {
    to: string;
    subject: string;
    text: string;
    attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/**
 * Mail something to the operator through the box's own relay.
 *
 * Shared by the Support report and feedback ingest, which differ in what they say
 * and to whom, not in how it leaves the box. The relay is the `smtp` mail-gateway on
 * the pcs network: it advertises neither STARTTLS nor AUTH, hence the plain
 * transport. The sender is the box itself, so the operator can tell PCSes apart in
 * their inbox.
 */
export async function sendOperatorMail(mail: OperatorMail): Promise<void> {
    const smtpHost = getConfig('SMTP_HOST') || 'smtp';
    const smtpPort = parseInt(getConfig('SMTP_PORT') || '587', 10);
    const domain = getConfig('DOMAIN') || 'unknown-pcs';

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: false,
        tls: { rejectUnauthorized: false },
        ignoreTLS: smtpPort === 25,
    });

    await transporter.sendMail({
        from: `"PCS ${domain}" <noreply@${domain}>`,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        attachments: mail.attachments ?? [],
    });
}
