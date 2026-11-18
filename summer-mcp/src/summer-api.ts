import { config } from './config';
import { canRefreshToken, summerToken } from './summer-token';

export type QueryValue = string | number | boolean | string[] | undefined | null;
export type Query = Record<string, QueryValue>;

/** A Summer API call that failed: HTTP status plus the server's message. */
export class SummerApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Thin client for the Summer HTTP API, acting as one user (see summerToken): every call carries that user's bearer
 * token, so the server's own permission checks decide what they can see and change.
 */
export class SummerApi {
  constructor(private readonly baseUrl = config.apiUrl) {}

  get<T>(path: string, query?: Query): Promise<T> {
    return this.call<T>('GET', path, { query });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('POST', path, { body });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('PUT', path, { body });
  }

  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('DELETE', path, { body });
  }

  /** Create / update a summary: multipart with the payload as JSON in the `summary` field (no files from the MCP). */
  summary<T>(method: 'POST' | 'PUT', payload: unknown): Promise<T> {
    const form = new FormData();
    form.append('summary', JSON.stringify(payload));
    return this.call<T>(method, '/summary', { form });
  }

  private async call<T>(method: string, path: string, opts: { query?: Query; body?: unknown; form?: FormData }): Promise<T> {
    try {
      return await this.send<T>(method, path, opts, await this.token());
    } catch (e) {
      // A fetched dev token may have expired (server restart): fetch a new one and try once more.
      if (!(e instanceof SummerApiError && e.status === 401 && canRefreshToken())) throw e;
      return this.send<T>(method, path, opts, await this.token(true));
    }
  }

  private async token(refresh = false): Promise<string> {
    try {
      return await summerToken(refresh);
    } catch (e) {
      throw new SummerApiError(0, (e as Error).message);
    }
  }

  private async send<T>(method: string, path: string, opts: { query?: Query; body?: unknown; form?: FormData }, token: string): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
      else url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
    let body: string | FormData | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(config.timeoutMs) });
    } catch (e) {
      throw new SummerApiError(0, `Summer API unreachable (${(e as Error).message})`);
    }

    const text = await res.text();
    if (!res.ok) throw new SummerApiError(res.status, errorMessage(res.status, text));
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }
}

function errorMessage(status: number, text: string): string {
  let message = text;
  try {
    const m = (JSON.parse(text) as { message?: unknown }).message;
    if (m) message = Array.isArray(m) ? m.join('; ') : String(m);
  } catch {
    // not JSON: keep the raw text
  }
  const prefix =
    status === 401
      ? 'Not signed in to Summer (the token was missing, expired or rejected)'
      : status === 403
        ? 'Not allowed'
        : status === 404
          ? 'Not found (or not visible to you)'
          : status === 409
            ? 'Conflict'
            : `Summer API error ${status}`;
  return message && message !== 'Unauthorized' && message !== 'Not Found' && message !== 'Forbidden' ? `${prefix}: ${message}` : prefix;
}
