import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './identity-provider';

const IS_PUBLIC = 'isPublic';
/** Opt a route out of authentication (health check, dev SSO popup). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

type AuthedRequest = Request & { user?: CurrentUser };

/**
 * Global guard: every route requires `authorization: bearer <token>`. The client also sends an `_id` header;
 * it is deliberately ignored — identity comes only from the verified token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const match = /^bearer\s+"?([^"\s]+)"?$/i.exec(req.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException();
    const user = await this.auth.resolve(match[1]);
    if (!user) throw new UnauthorizedException();
    req.user = user;
    return true;
  }
}

export const Me = createParamDecorator((_: unknown, ctx: ExecutionContext): CurrentUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});
