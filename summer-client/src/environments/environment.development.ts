import { AppEnvironment } from '../app/core/config/app-config';
import { baseEnvironment } from './environment.base';

/** Dev: talks to summer-server on :8080 through the dev proxy (proxy.conf.json). */
export const environment: AppEnvironment = {
  ...baseEnvironment,
  production: false,
  avatarUrl: '',
  userMonitoring: '',
};
