import { AppEnvironment } from '../app/core/config/app-config';
import { baseEnvironment } from './environment.base';

/** Dev: in-browser mock API with a fixed logged-in user, so the app runs with no backend or login. Set mockApi:false to hit :8080 via proxy. */
export const environment: AppEnvironment = {
  ...baseEnvironment,
  production: false,
  mockApi: true,
  avatarUrl: '',
  userMonitoring: '',
};
