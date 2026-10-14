import type { Asset } from './types';

/** Base URL of the BrandForge API (no secrets, presentation layer only). */
export const baseUrl: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3013';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toApiError(body: unknown, status: number): ApiError {
  if (body && typeof body === 'object') {
    const env = body as ErrorEnvelope;
    if (env.error) {
      return new ApiError(env.error.code ?? 'UNKNOWN_ERROR', env.error.message ?? 'Request failed', status);
    }
  }
  return new ApiError('UNKNOWN_ERROR', `Request failed with status ${status}`, status);
}

/**
 * Thin fetch wrapper for the BrandForge API.
 * - Cookie session (`bf_session`), so `credentials: 'include'` is always sent.
 * - JSON request/response with the `{error:{code,message}}` envelope parsed into ApiError.
 */
export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  // Avoid a double /api when VITE_API_URL already ends with /api and the
  // route path also starts with /api/ (e.g. https://host/brandforge/api + /api/v1/...).
  const normalizedPath = baseUrl.endsWith('/api') && path.startsWith('/api/') ? path.slice(4) : path;
  const headers = new Headers(opts.headers);
  const isFormData = opts.body instanceof FormData;
  if (opts.body !== undefined && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${baseUrl}${normalizedPath}`, {
    ...opts,
    headers,
    credentials: 'include',
  });

  const body = await parseBody(res);

  if (!res.ok) {
    throw toApiError(body, res.status);
  }
  return body as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data) });
export const put = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(data) });
export const patch = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export const del = <T>(path: string, data?: unknown) =>
  api<T>(path, {
    method: 'DELETE',
    body: data === undefined ? undefined : JSON.stringify(data),
  });

/** Asset URLs come back as `/api/v1/assets/:id` — prefix with the API base URL. */
export function assetUrl(asset: Asset): string {
  if (asset.url.startsWith('http')) return asset.url;
  return `${baseUrl}${asset.url}`;
}
