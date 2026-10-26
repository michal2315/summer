/** LOAD_DATABASE_URL, or DATABASE_URL with its database renamed to `summer_load`. */
export function loadDatabaseUrl(databaseUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.LOAD_DATABASE_URL) return env.LOAD_DATABASE_URL;
  const url = new URL(databaseUrl);
  url.pathname = '/summer_load';
  return url.toString();
}
