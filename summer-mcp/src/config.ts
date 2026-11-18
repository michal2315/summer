import 'dotenv/config';
import { z } from 'zod';

const env = z
  .object({
    /** Summer API base URL, including the `/api` prefix. */
    SUMMER_API_URL: z.string().url().default('http://localhost:8080/api'),
    /** HTTP mode: port to listen on. */
    PORT: z.coerce.number().int().positive().default(8090),
    /** The Summer token every call is made with. Unset: a dev token is fetched from the server (dev servers only). */
    SUMMER_TOKEN: z.string().optional(),
    /** Without SUMMER_TOKEN: the dev user to act as (username). Unset: the server's default dev user. */
    SUMMER_DEV_USER: z.string().optional(),
    /** Summer's APP_TIMEZONE: event dates are calendar days in this zone. */
    SUMMER_TIMEZONE: z.string().default('Asia/Jerusalem'),
    /** Per-call timeout towards the Summer API. */
    SUMMER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  })
  .parse(process.env);

export const config = {
  apiUrl: env.SUMMER_API_URL.replace(/\/+$/, ''),
  port: env.PORT,
  token: env.SUMMER_TOKEN?.trim() || undefined,
  devUser: env.SUMMER_DEV_USER?.trim() || undefined,
  timeZone: env.SUMMER_TIMEZONE,
  timeoutMs: env.SUMMER_TIMEOUT_MS,
};
