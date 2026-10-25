import { NestExpressApplication } from '@nestjs/platform-express';

/** HTTP settings shared by main.ts and the e2e tests. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  // Behind the Angular dev proxy / a reverse proxy in production; the client is same-origin, so no CORS.
  app.set('trust proxy', 'loopback');
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });
  return app;
}
