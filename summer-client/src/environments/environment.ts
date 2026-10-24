import { AppEnvironment } from '../app/core/config/app-config';
import { baseEnvironment } from './environment.base';

/** Production. Any key can be overridden at deploy time via public/env-config.js (window._env_). */
export const environment: AppEnvironment = baseEnvironment;
