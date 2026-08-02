import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {getConfig} from '@/configuration/getConfigBackend';

// HMAC key for signing the admin session cookie. The previous design
// generated a JWT_SECRET at process start, which invalidated every user's
// session on container restart. We persist the key to the /app/data bind so
// restarts and deploys don't sign anyone out.
//
// This file is the ONLY thing the container keeps in /app/data; everything else
// the app touches lives on the host and is reached over SSH. On a PCS the bind
// source is /DATA/AppData/yundera/admin — deliberately NOT the stack directory,
// which template-root rsyncs with --delete and would wipe this key on every
// update (template-root migrations/2026-08-02-13-move-admin-session-key.sh).
//
// Lookup order:
//   1. SESSION_KEY env/config — exact key bytes (base64), useful in dev.
//   2. SESSION_KEY_PATH file — read or create. Default: /app/data/admin-session-key.
//   3. In-memory random fallback if the file path is unwritable. Logged.

const DEFAULT_PATH = '/app/data/admin-session-key';

function loadKey(): Uint8Array {
  const inline = getConfig('SESSION_KEY');
  if (inline) {
    return new Uint8Array(Buffer.from(inline, 'base64'));
  }

  const filePath = getConfig('SESSION_KEY_PATH') || DEFAULT_PATH;
  try {
    if (fs.existsSync(filePath)) {
      const bytes = fs.readFileSync(filePath);
      if (bytes.length >= 32) return new Uint8Array(bytes);
    }
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    const fresh = crypto.randomBytes(64);
    fs.writeFileSync(filePath, fresh, {mode: 0o600});
    return new Uint8Array(fresh);
  } catch (err) {
    console.warn(`[sessionKey] cannot persist key at ${filePath}: ${String(err)}. Using ephemeral in-memory key — sessions will not survive restart.`);
    return new Uint8Array(crypto.randomBytes(64));
  }
}

export const SESSION_KEY = loadKey();
