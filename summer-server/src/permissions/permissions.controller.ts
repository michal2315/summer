import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { Me } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/identity-provider';
import { ApiPermission, toApiPermission } from '../common/api-types';
import { IdPipe, isUuid, parse } from '../common/validation';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PermissionsRepository } from './permissions.repository';

const permissionBody = z.object({
  _id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  groupName: z.string().trim().min(1).max(200),
  color: z
    .string()
    .regex(/^#[0-9a-f]{3,8}$/i)
    .default('#808080'),
});

@Controller('permissions')
export class PermissionsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly permissions: PermissionsRepository,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(): Promise<ApiPermission[]> {
    return (await this.permissions.list()).map(toApiPermission);
  }

  /** The permission groups the caller belongs to. */
  @Get('user')
  async mine(@Me() me: CurrentUser): Promise<ApiPermission[]> {
    return (await this.permissions.byGroupNames(me.groupKeys)).map(toApiPermission);
  }

  @Get('permitted')
  permitted(@Me() me: CurrentUser): boolean {
    return this.canManage(me);
  }

  /** Create (no `_id`) or update a permission group. */
  @Put()
  async save(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiPermission> {
    this.assertAdmin(me);
    const { _id, ...values } = parse(permissionBody, body);
    if (_id) {
      if (!isUuid(_id)) throw new NotFoundException();
      const row = await this.permissions.update(_id, values);
      if (!row) throw new NotFoundException();
      return toApiPermission(row);
    }
    return toApiPermission(await this.permissions.insert(values));
  }

  /** Refused while any summary or folder still requires it: dropping a requirement would silently widen access. */
  @Delete(':id')
  async remove(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<object> {
    this.assertAdmin(me);
    if (await this.permissions.isReferenced(id)) throw new ConflictException('permission is still assigned to summaries or folders');
    if (!(await this.permissions.delete(id))) throw new NotFoundException();
    return {};
  }

  private canManage(me: CurrentUser): boolean {
    return this.auth.inAnyGroup(me, this.config.access.permissionAdminGroups);
  }

  private assertAdmin(me: CurrentUser): void {
    if (!this.canManage(me)) throw new ForbiddenException();
  }
}
