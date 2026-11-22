import { config } from './config';

let cached: Promise<string> | undefined;

/**
 * The Summer token the MCP calls the API with. For now the MCP itself has no sign-in: every caller acts as one user,
 * SUMMER_TOKEN if set, otherwise a token from the dev server's `/auth/dev-token` (SUMMER_DEV_USER, or its default user).
 */
export function summerToken(refresh = false): Promise<string> {
  if (config.token) return Promise.resolve(config.token);
  if (!cached || refresh) {
    cached = fetchDevToken();
    cached.catch(() => (cached = undefined));
  }
  return cached;
}

/** Whether a rejected token can be replaced (a fetched dev token can; a configured one can't). */
export const canRefreshToken = (): boolean => !config.token;

async function fetchDevToken(): Promise<string> {
  const url = new URL(`${config.apiUrl}/auth/dev-token`);
  if (config.devUser) url.searchParams.set('as', config.devUser);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(config.timeoutMs) });
  } catch (e) {
    throw new Error(`Summer API unreachable at ${config.apiUrl} (${(e as Error).message})`);
  }
  if (!res.ok) throw new Error(`No SUMMER_TOKEN set and the server gave no dev token (${res.status}). Set SUMMER_TOKEN, or run against a dev server.`);
  return ((await res.json()) as { token: string }).token;
}
