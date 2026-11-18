import { IPermission, IUserGroup } from '../../../shared/models';

const SHOWN = 3;

/** "Dana Levi, Avi Cohen, Research team +2": the first few members by name, then how many more. */
export function describeMembers(g: IUserGroup, permissions: Map<string, IPermission>): string {
  const names = [...g.users.map((u) => u.fullName), ...g.permissions.flatMap((id) => permissions.get(id)?.name ?? [])];
  if (!names.length) return 'אין חברים';
  const rest = names.length - SHOWN;
  return names.slice(0, SHOWN).join(', ') + (rest > 0 ? ` +${rest}` : '');
}
