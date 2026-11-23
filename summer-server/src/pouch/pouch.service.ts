import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiPouchFormat } from '../common/api-types';
import { parse, zId } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { POUCH_MODES, POUCH_ROLES, PouchPage, PouchRole } from '../database/schema';
import { checkDoc } from './pouch-doc';
import { renderDocx } from './pouch-docx';
import { validUserSet } from '../users/user-set';
import { UsersRepository } from '../users/users.repository';
import { PouchFormatWithOwner, PouchMember, PouchRepository } from './pouch.repository';

const MAX_FORMATS = 100;
const MAX_MEMBERS = 100;
/** Who the owner shares a format with, and what each may do. */
const members = z.array(z.object({ user: zId, role: z.enum(POUCH_ROLES).default('viewer') })).max(MAX_MEMBERS);
const SHARED_PAGE = 30;

const name = z.string().trim().min(1).max(80);
const page = z.object({
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  margins: z.enum(['narrow', 'normal', 'wide']).default('normal'),
});
const DEFAULT_PAGE: PouchPage = { orientation: 'portrait', margins: 'normal' };

const createBody = z.object({
  name,
  mode: z.enum(POUCH_MODES).default('perSummary'),
  doc: z.unknown(),
  page: page.default(DEFAULT_PAGE),
  isFavorite: z.boolean().default(false),
  isShared: z.boolean().default(false),
  members: members.default([]),
});

const updateBody = z.object({
  name: name.optional(),
  mode: z.enum(POUCH_MODES).optional(),
  doc: z.unknown().optional(),
  page: page.optional(),
  isFavorite: z.boolean().optional(),
  isShared: z.boolean().optional(),
  members: members.optional(),
});

/** What only the owner changes: who it's shared with (people and everyone) and their own favourite flag. */
const OWNER_ONLY = ['isShared', 'members', 'isFavorite'] as const;

const copyBody = z.object({ name: name.optional() });

const sharedQuery = z.object({
  q: z.string().trim().max(120).default(''),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const docxBody = z.object({
  doc: z.unknown(),
  page: page.default(DEFAULT_PAGE),
  title: z.string().trim().max(200).default(''),
});

const toApi =
  (me: CurrentUser) =>
  ({ format: f, owner, members }: PouchFormatWithOwner): ApiPouchFormat => ({
    _id: f.id,
    name: f.name,
    mode: f.mode,
    doc: f.doc,
    page: f.page,
    isFavorite: f.ownerId === me.id && f.isFavorite,
    isShared: f.isShared,
    isMine: f.ownerId === me.id,
    role: roleOf(me, f.ownerId, members),
    canEdit: roleOf(me, f.ownerId, members) === 'owner' || roleOf(me, f.ownerId, members) === 'editor',
    owner,
    // Only the owner sees the whole list; others see the owner and themselves.
    members: f.ownerId === me.id ? members : members.filter((m) => m.user._id === me.id),
    creationDate: f.createdAt.toISOString(),
    updateDate: f.updatedAt.toISOString(),
  });

/** The caller's relation to a format: owner, shared with them personally (viewer / editor), or only via "everyone". */
function roleOf(me: CurrentUser, ownerId: string, members: PouchMember[]): 'owner' | PouchRole | 'public' {
  if (ownerId === me.id) return 'owner';
  return members.find((m) => m.user._id === me.id)?.role ?? 'public';
}

/**
 * Pouch: personal export formats. Two kinds of sharing: with chosen people — each to use it (viewer: export with it,
 * copy it) or also to change it (editor) — and with everyone (find, use, copy). Only the owner shares, picks roles or
 * deletes. Names are unique per owner. Also renders a (filled) Pouch document as a Word file.
 */
@Injectable()
export class PouchService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: PouchRepository,
    private readonly users: UsersRepository,
  ) {}

  async list(me: CurrentUser): Promise<ApiPouchFormat[]> {
    return (await this.repo.mine(me.id)).map(toApi(me));
  }

  /** Others' shared formats, a page at a time; `q` narrows by name or owner. */
  async shared(me: CurrentUser, query: unknown): Promise<ApiPouchFormat[]> {
    const { q, offset } = parse(sharedQuery, query);
    return (await this.repo.shared(me.id, q, SHARED_PAGE, offset)).map(toApi(me));
  }

  async get(me: CurrentUser, id: string): Promise<ApiPouchFormat> {
    const row = await this.repo.one(me.id, id);
    if (!row) throw new NotFoundException();
    return toApi(me)(row);
  }

  async create(me: CurrentUser, body: unknown): Promise<ApiPouchFormat> {
    const input = parse(createBody, body);
    const doc = checkDoc(input.doc) as unknown as Record<string, unknown>;
    const shareWith = await this.validMembers(me, input.members);
    const { members: _members, ...values } = input;
    const id = await this.database.transaction(async () => {
      const newId = await this.insertMine(me, { ...values, doc });
      await this.repo.setMembers(newId, shareWith);
      return newId;
    });
    return this.get(me, id);
  }

  /** A private copy of a format (the caller's or a shared one) as the caller's own. */
  async copy(me: CurrentUser, id: string, body: unknown): Promise<ApiPouchFormat> {
    const { name } = parse(copyBody, body ?? {});
    const source = await this.get(me, id);
    const newId = await this.database.transaction(async () => {
      const wanted = name ?? (source.isMine ? `${source.name} (עותק)` : source.name);
      return this.insertMine(me, {
        name: await this.freeName(me, wanted),
        mode: source.mode,
        doc: source.doc,
        page: source.page,
        isFavorite: false,
        isShared: false,
      });
    });
    return this.get(me, newId);
  }

  async update(me: CurrentUser, id: string, body: unknown): Promise<ApiPouchFormat> {
    const input = parse(updateBody, body);
    const doc = input.doc === undefined ? undefined : (checkDoc(input.doc) as unknown as Record<string, unknown>);
    await this.database.transaction(async () => {
      const current = await this.editable(me, id);
      const isOwner = current.format.ownerId === me.id;
      const ownerOnly = OWNER_ONLY.filter((k) => input[k] !== undefined);
      if (!isOwner && ownerOnly.length) throw new ForbiddenException(`only the owner can change ${ownerOnly.join(', ')}`);
      if (input.name !== undefined) await this.assertNameFree({ id: current.format.ownerId }, input.name, id);
      if (input.members !== undefined) await this.repo.setMembers(id, await this.validMembers(me, input.members));
      await this.repo.update(id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        ...(doc !== undefined ? { doc } : {}),
        ...(input.page !== undefined ? { page: input.page } : {}),
        ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}),
        ...(input.isShared !== undefined ? { isShared: input.isShared } : {}),
      });
    });
    return this.get(me, id);
  }

  async remove(me: CurrentUser, id: string): Promise<void> {
    await this.owned(me, id);
    if (!(await this.repo.delete(me.id, id))) throw new NotFoundException();
  }

  /** A filled-in Pouch document (from the export preview, possibly edited there) → .docx. */
  async docx(body: unknown): Promise<Buffer> {
    const input = parse(docxBody, body);
    return renderDocx(checkDoc(input.doc), input.page, input.title);
  }

  /** Only the owner deletes a format. */
  private async owned(me: CurrentUser, id: string): Promise<PouchFormatWithOwner> {
    const row = await this.repo.one(me.id, id);
    if (!row) throw new NotFoundException();
    if (row.format.ownerId !== me.id) throw new ForbiddenException('only the owner can delete this format');
    return row;
  }

  /** The owner and the people it's shared with as editors change a format; viewers only use it. */
  private async editable(me: CurrentUser, id: string): Promise<PouchFormatWithOwner> {
    const row = await this.repo.one(me.id, id);
    if (!row) throw new NotFoundException();
    const role = roleOf(me, row.format.ownerId, row.members);
    if (role !== 'owner' && role !== 'editor') throw new ForbiddenException('you may not edit this format');
    return row;
  }

  /** Existing users, each once (the last role given wins); the owner is left out (it's theirs anyway). */
  private async validMembers(me: CurrentUser, list: { user: string; role: PouchRole }[]): Promise<{ userId: string; role: PouchRole }[]> {
    const byUser = new Map(list.filter((m) => m.user !== me.id).map((m) => [m.user, m.role]));
    const ids = await validUserSet(this.users, [...byUser.keys()], 'users');
    return ids.map((userId) => ({ userId, role: byUser.get(userId)! }));
  }

  private async insertMine(me: CurrentUser, values: Parameters<PouchRepository['insert']>[1]): Promise<string> {
    if ((await this.repo.countOwned(me.id)) >= MAX_FORMATS) throw new BadRequestException(`up to ${MAX_FORMATS} formats`);
    await this.assertNameFree(me, values.name);
    return (await this.repo.insert(me.id, values)).id;
  }

  private async assertNameFree(me: { id: string }, name: string, except?: string): Promise<void> {
    const clash = await this.repo.ownedByName(me.id, name);
    if (clash && clash.id !== except) throw new ConflictException(`a format named "${clash.name}" already exists`);
  }

  /** `name`, or `name (2)`, `name (3)`… — the first the caller doesn't have yet (copies shouldn't fail on a name clash). */
  private async freeName(me: CurrentUser, name: string): Promise<string> {
    for (let i = 1; i < MAX_FORMATS + 2; i++) {
      const candidate = i === 1 ? name : `${name} (${i})`.slice(-80);
      if (!(await this.repo.ownedByName(me.id, candidate))) return candidate;
    }
    return name;
  }
}
