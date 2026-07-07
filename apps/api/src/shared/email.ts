import { env } from '../config/env.js';

// Transactional email via the Resend REST API (native fetch — no SDK dependency).
// SECURITY: never log `text`/`subject` here — reset emails carry live credentials
// (tokenized links). Errors are reported by status code only.

interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

/** Whether outbound email is configured (RESEND_API_KEY present). */
export function isEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export async function sendEmail({ to, subject, text }: SendEmailInput): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error('Email is not configured (RESEND_API_KEY missing)');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
  });

  if (!res.ok) {
    throw new Error(`Resend API responded ${res.status}`);
  }
}
