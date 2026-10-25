import { BadRequestException } from '@nestjs/common';
import { unique } from '../common/validation';
import { UsersRepository } from './users.repository';

/** Validates a list of users being assigned (managers, tagged users): existing, active, non-system. */
export async function validUserSet(repo: UsersRepository, ids: string[], what: string): Promise<string[]> {
  const userIds = unique(ids);
  if ((await repo.existingIds(userIds)).length !== userIds.length) throw new BadRequestException(`unknown ${what}`);
  return userIds;
}
