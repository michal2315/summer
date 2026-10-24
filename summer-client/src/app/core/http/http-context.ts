import { HttpContextToken } from '@angular/common/http';

/** Set on a request to stop the error interceptor from toasting (caller handles the error itself). */
export const SILENT_ERRORS = new HttpContextToken<boolean>(() => false);
