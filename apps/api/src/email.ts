/**
 * Email module (nodemailer).
 *
 * MAIL_TRANSPORT=maildir (default, dev): renders the message with nodemailer's
 * stream transport and writes a `.eml` file to MAILDIR_PATH, plus a log line.
 * MAIL_TRANSPORT=smtp: sends via SMTP_* env vars.
 *
 * Templates are self-contained HTML with inline styles and BrandForge
 * branding — no external images.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.js';

let transporter: Transporter | null = null;

export function getTransporter(): Transporter {
  if (!transporter) {
    if (config.mailTransport === 'smtp') {
      transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      });
    } else {
      transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    }
  }
  return transporter;
}

function brandShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#F7F3EA;font-family:Inter,Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
<div style="background:#1E3D2F;border-radius:12px 12px 0 0;padding:24px 32px;">
<div style="color:#F7F3EA;font-size:22px;font-weight:700;letter-spacing:0.5px;">BrandForge <span style="color:#C9A227;">AI</span></div>
</div>
<div style="background:#ffffff;border-radius:0 0 12px 12px;padding:32px;">
${bodyHtml}
</div>
<div style="text-align:center;color:#8a8a8a;font-size:12px;padding:20px 0 0;">
BrandForge AI &mdash; agentic branding platform
</div>
</div></body></html>`;
}

const btn = (href: string, label: string) =>
  `<p style="margin:28px 0;"><a href="${href}" style="display:inline-block;background:#1E3D2F;color:#F7F3EA;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:8px;">${label}</a></p>`;

export interface EmailContent {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function verificationEmail(to: string, name: string, link: string): EmailContent {
  return {
    to,
    subject: 'Verify your BrandForge account',
    html: brandShell(
      'Verify your account',
      `<h2 style="color:#1E3D2F;margin:0 0 12px;">Hi ${escapeHtml(name)},</h2>
<p style="color:#333;line-height:1.6;">Thanks for joining BrandForge. Please confirm your email address to activate your account. This link expires in 24 hours.</p>
${btn(link, 'Verify my email')}
<p style="color:#666;font-size:13px;line-height:1.6;">If the button does not work, paste this link into your browser:<br><span style="color:#1E3D2F;">${escapeHtml(link)}</span></p>`,
    ),
    text: `Hi ${name},\n\nThanks for joining BrandForge. Verify your email within 24 hours:\n${link}\n`,
  };
}

export function resetPasswordEmail(to: string, name: string, link: string): EmailContent {
  return {
    to,
    subject: 'Reset your BrandForge password',
    html: brandShell(
      'Reset your password',
      `<h2 style="color:#1E3D2F;margin:0 0 12px;">Hi ${escapeHtml(name)},</h2>
<p style="color:#333;line-height:1.6;">We received a request to reset your BrandForge password. This link expires in 1 hour. If you did not ask for this, you can safely ignore this email.</p>
${btn(link, 'Reset my password')}
<p style="color:#666;font-size:13px;line-height:1.6;">Or paste this link into your browser:<br><span style="color:#1E3D2F;">${escapeHtml(link)}</span></p>`,
    ),
    text: `Hi ${name},\n\nReset your BrandForge password within 1 hour:\n${link}\n\nIf you did not ask for this, ignore this email.\n`,
  };
}

export function welcomeEmail(to: string, name: string): EmailContent {
  return {
    to,
    subject: 'Welcome to BrandForge 🎉',
    html: brandShell(
      'Welcome to BrandForge',
      `<h2 style="color:#1E3D2F;margin:0 0 12px;">Welcome aboard, ${escapeHtml(name)}!</h2>
<p style="color:#333;line-height:1.6;">Your account is verified. Create a workspace, start a project, and use the AI agent to build campaigns, brand kits, assets and landing pages.</p>
${btn(config.frontendUrl, 'Open BrandForge')}`,
    ),
    text: `Welcome aboard, ${name}!\n\nYour BrandForge account is verified. Open ${config.frontendUrl} to get started.\n`,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Send (or, in maildir mode, persist + log) an email. Never throws fatally. */
export async function sendEmail(content: EmailContent): Promise<void> {
  const info = await getTransporter().sendMail({
    from: config.mailFrom,
    to: content.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
  if (config.mailTransport === 'maildir') {
    await mkdir(config.maildirPath, { recursive: true });
    const file = path.join(config.maildirPath, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.eml`);
    const raw = (info as unknown as { message?: Buffer | string }).message;
    await writeFile(file, typeof raw === 'string' ? raw : (raw as Buffer));
    console.log(`[mail] wrote ${file} (to=${content.to}, subject="${content.subject}")`);
  }
}
