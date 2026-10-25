import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

interface PgError {
  code?: string;
  constraint?: string;
}

/** PostgreSQL SQLSTATE → HTTP. Services validate first; these are the database's last line of defence. */
const PG_STATUS: Record<string, number> = {
  '23505': HttpStatus.CONFLICT, // unique_violation
  '23503': HttpStatus.BAD_REQUEST, // foreign_key_violation
  '23514': HttpStatus.BAD_REQUEST, // check_violation (incl. min-one-permission triggers)
  '23502': HttpStatus.BAD_REQUEST, // not_null_violation
  '22P02': HttpStatus.BAD_REQUEST, // invalid_text_representation
  '40001': HttpStatus.CONFLICT, // serialization_failure
  '40P01': HttpStatus.CONFLICT, // deadlock_detected
};

function pgErrorOf(e: unknown): PgError | undefined {
  // drizzle wraps driver errors in DrizzleQueryError with the pg error as `cause`.
  for (let cur = e as { code?: unknown; cause?: unknown } | undefined, i = 0; cur && i < 3; cur = cur.cause as typeof cur, i++) {
    if (typeof cur.code === 'string' && /^[0-9A-Z]{5}$/.test(cur.code)) return cur as PgError;
  }
  return undefined;
}

/** Consistent JSON errors; never leaks SQL, stack traces or row data to the client. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res.status(exception.getStatus()).json(typeof body === 'string' ? { statusCode: exception.getStatus(), message: body } : body);
      return;
    }

    const pg = pgErrorOf(exception);
    const status = (pg?.code && PG_STATUS[pg.code]) || HttpStatus.INTERNAL_SERVER_ERROR;
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    else this.logger.warn(`database rejected request: ${pg?.code} ${pg?.constraint ?? ''}`);
    res.status(status).json({ statusCode: status, message: status === 500 ? 'Internal server error' : 'Request conflicts with stored data' });
  }
}
