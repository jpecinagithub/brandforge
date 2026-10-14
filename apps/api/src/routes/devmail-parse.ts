/**
 * Minimal RFC822 / MIME parser for the .eml files written by the maildir
 * transport (nodemailer stream transport). Handles header unfolding,
 * RFC2047 encoded words, multipart/alternative, quoted-printable and base64.
 * Only what the dev-mail viewer needs — not a general MIME library.
 */

export interface ParsedEmail {
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
  html: string;
}

function decodeRfc2047(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset, enc, data) => {
    try {
      const buf =
        enc.toUpperCase() === 'B'
          ? Buffer.from(data, 'base64')
          : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_h, hex) => String.fromCharCode(parseInt(hex, 16))), 'binary');
      return buf.toString((charset as string).toLowerCase().includes('utf') ? 'utf8' : 'latin1');
    } catch {
      return data;
    }
  });
}

function decodeQuotedPrintable(s: string): string {
  const noSoftBreaks = s.replace(/=\r?\n/g, '');
  const bytes = noSoftBreaks.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(bytes, 'binary').toString('utf8');
}

function decodeBody(body: string, encoding: string): string {
  const enc = encoding.trim().toLowerCase();
  if (enc === 'base64') {
    try {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      return body;
    }
  }
  if (enc === 'quoted-printable') return decodeQuotedPrintable(body);
  return body;
}

function parseHeaders(raw: string): Map<string, string> {
  const headers = new Map<string, string>();
  let current: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) {
      headers.set(current, (headers.get(current) ?? '') + ' ' + line.trim());
    } else {
      const m = line.match(/^([^:]+):\s*(.*)$/);
      if (m) {
        current = m[1].toLowerCase();
        headers.set(current, m[2].trim());
      } else {
        current = null;
      }
    }
  }
  return headers;
}

export function parseEml(raw: string): ParsedEmail {
  const idx = raw.search(/\r?\n\r?\n/);
  const headRaw = idx >= 0 ? raw.slice(0, idx) : raw;
  const bodyRaw = idx >= 0 ? raw.slice(idx).replace(/^\r?\n\r?\n/, '') : '';
  const headers = parseHeaders(headRaw);
  const contentType = headers.get('content-type') ?? 'text/plain';

  let text = '';
  let html = '';
  const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = bodyRaw.split(`--${boundary}`);
    for (const part of parts) {
      const pIdx = part.search(/\r?\n\r?\n/);
      if (pIdx < 0) continue;
      const pHeaders = parseHeaders(part.slice(0, pIdx));
      const pBody = part.slice(pIdx).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '');
      const pType = (pHeaders.get('content-type') ?? '').toLowerCase();
      const decoded = decodeBody(pBody, pHeaders.get('content-transfer-encoding') ?? '7bit');
      if (pType.includes('text/html')) html = decoded;
      else if (pType.includes('text/plain')) text = decoded;
    }
  } else {
    const decoded = decodeBody(bodyRaw.trim(), headers.get('content-transfer-encoding') ?? '7bit');
    if (contentType.toLowerCase().includes('text/html')) html = decoded;
    else text = decoded;
  }

  return {
    from: decodeRfc2047(headers.get('from') ?? ''),
    to: decodeRfc2047(headers.get('to') ?? ''),
    subject: decodeRfc2047(headers.get('subject') ?? '(no subject)'),
    date: headers.get('date') ?? '',
    text: text.trim(),
    html: html.trim(),
  };
}
