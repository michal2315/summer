import { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';

/** Pouch formats and the documents rendered from them carry images inline (data URLs), so they may be large. */
const POUCH_BODY_LIMIT = '25mb';

/** HTTP settings shared by main.ts and the e2e tests. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  // Behind the Angular dev proxy / a reverse proxy in production; the client is same-origin, so no CORS.
  app.set('trust proxy', 'loopback');
  // Registered before the general parser, which then skips bodies already parsed.
  app.use('/api/pouch-formats', json({ limit: POUCH_BODY_LIMIT }));
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });
  return app;
}
