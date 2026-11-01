import { BadRequestException } from '@nestjs/common';
import { CurrentUser } from '../auth/identity-provider';
import { unique } from '../common/validation';
import { PermissionsRepository } from './permissions.repository';

/**
 * Validates a permission set someone is assigning to a summary or folder: ids exist, at least one
 * when `required`, and only groups the caller holds (decision A6 — otherwise you would create something you
 * cannot see yourself under the all-of rule).
 */
export async function validPermissionSet(repo: PermissionsRepository, me: CurrentUser, ids: string[], opts: { required: boolean; what: string }): Promise<string[]> {
  const permissionIds = unique(ids);
  if (opts.required && !permissionIds.length) throw new BadRequestException(`${opts.what} needs at least one permission`);
  if ((await repo.byIds(permissionIds)).length !== permissionIds.length) throw new BadRequestException('unknown permission');
  if (permissionIds.some((p) => !me.permissionIds.includes(p))) throw new BadRequestException('you can only assign permission groups you belong to');
  return permissionIds;
}
