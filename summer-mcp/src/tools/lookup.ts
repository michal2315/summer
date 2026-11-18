import { z } from 'zod';
import { ApiCapsule, ApiContentType, ApiField, ApiFolder, ApiPermission, ApiUser, UserRef } from '../api-types';
import { permissionGroup, user } from '../schemas';
import { defineTool, Tool } from '../tool';

const userOut = (u: UserRef) => ({ id: u._id, name: u.fullName, username: u.username, department: u.department || undefined });
const permissionOut = (p: ApiPermission) => ({ id: p._id, name: p.name, group: p.groupName || undefined });

/** Reference data: turns words like "label X", "Dana" or "#capsule" into the names and ids searches and writes need. */
export const lookupTools: Tool[] = [
  defineTool({
    name: 'get_catalog',
    title: 'Get Summer catalog',
    description:
      'Reference data for building searches and writing summaries: who you are, content types with their fields, ' +
      'permission groups (all of them, and the ones you belong to, which are the only ones you can put on a summary), ' +
      'and labels. Labels are many, so pass `labelSearch` to list the ones containing that text (20 per page).',
    input: {
      include: z
        .array(z.enum(['me', 'contentTypes', 'permissions', 'labels']))
        .optional()
        .describe('Which parts to return. Default: all.'),
      labelSearch: z.string().max(100).optional().describe('Text the label names contain. Empty lists labels from the start.'),
      labelOffset: z.number().int().min(0).optional().describe('Skip this many labels (paging, 20 per page).'),
    },
    output: {
      me: user.extend({ favoriteLabels: z.array(z.string()) }).optional(),
      contentTypes: z
        .array(
          z.object({
            id: z.string(),
            name: z.string().describe('What search filters take.'),
            displayName: z.string(),
            fields: z.array(z.object({ fieldId: z.string(), name: z.string().optional(), type: z.string().optional(), required: z.boolean() })),
          }),
        )
        .optional(),
      permissionGroups: z.array(permissionGroup).optional(),
      myPermissionGroups: z.array(permissionGroup).optional().describe('The only groups you can put on a summary.'),
      labels: z.object({ items: z.array(z.string()), offset: z.number(), more: z.boolean() }).optional(),
    },
    run: async ({ include, labelSearch, labelOffset }, api) => {
      const want = new Set(include?.length ? include : ['me', 'contentTypes', 'permissions', 'labels']);
      const [me, types, fields, all, mine, labels] = await Promise.all([
        want.has('me') ? api.get<ApiUser>('/user') : undefined,
        want.has('contentTypes') ? api.get<ApiContentType[]>('/content-type') : undefined,
        want.has('contentTypes') ? api.get<ApiField[]>('/field') : undefined,
        want.has('permissions') ? api.get<ApiPermission[]>('/permissions') : undefined,
        want.has('permissions') ? api.get<ApiPermission[]>('/permissions/user') : undefined,
        want.has('labels') ? api.get<string[]>('/labels', { text: labelSearch ?? '', skip: labelOffset ?? 0 }) : undefined,
      ]);
      const fieldById = new Map((fields ?? []).map((f) => [f._id, f]));
      return {
        me: me && { ...userOut(me), favoriteLabels: me.favoriteLabels },
        contentTypes: types?.map((t) => ({
          id: t._id,
          name: t.name,
          displayName: t.displayName,
          fields: t.fields.map((f) => ({ fieldId: f.field, name: fieldById.get(f.field)?.name, type: fieldById.get(f.field)?.type, required: f.required })),
        })),
        permissionGroups: all?.map(permissionOut),
        myPermissionGroups: mine?.map(permissionOut),
        labels: labels && { items: labels, offset: labelOffset ?? 0, more: labels.length === 20 },
      };
    },
  }),

  defineTool({
    name: 'find_users',
    title: 'Find users',
    description: 'Find Summer users by name or username (part of it is enough). Use the ids as authors, tagged users or mentions.',
    input: { text: z.string().min(1).max(100).describe('Part of the full name or the start of the username.') },
    output: { items: z.array(user) },
    run: async ({ text }, api) => {
      const [byName, byUsername] = await Promise.all([
        api.get<UserRef[]>(`/user/name/${encodeURIComponent(text)}`),
        api.get<UserRef[]>(`/user/query/${encodeURIComponent(text)}`),
      ]);
      const seen = new Set<string>();
      return { items: [...byName, ...byUsername].filter((u) => !u.isSystem && !seen.has(u._id) && seen.add(u._id)).map(userOut) };
    },
  }),

  defineTool({
    name: 'find_capsules',
    title: 'Find capsules',
    description:
      'Capsules are shared, named word lists used in searches. Each word has a condition: must (has to appear), ' +
      'mustNot (may not appear) or optional. Use a capsule id in search_summaries `capsuleIds`.',
    input: {
      text: z.string().max(100).optional().describe('Part of the capsule name. Empty lists capsules from the start.'),
      limit: z.number().int().min(1).max(100).optional().describe('Default 30.'),
    },
    output: {
      items: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional(),
          words: z.array(z.object({ word: z.string(), condition: z.enum(['must', 'mustNot', 'optional']) })),
        }),
      ),
    },
    run: async ({ text, limit }, api) => ({
      items: (await api.get<ApiCapsule[]>('/capsules', { q: text ?? '', limit: limit ?? 30 })).map((c) => ({
        id: c._id,
        name: c.name,
        description: c.description || undefined,
        words: c.words,
      })),
    }),
  }),

  defineTool({
    name: 'list_folders',
    title: 'List folders',
    description:
      "The folder tree you can see, as a flat list with each folder's full path. `count` is the summaries you can see in it and its subfolders. " +
      '`youManage`: you can place summaries in it and take them out.',
    input: {},
    output: {
      items: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          path: z.string(),
          parentId: z.string().nullable(),
          count: z.number(),
          directCount: z.number(),
          youManage: z.boolean(),
        }),
      ),
    },
    run: async (_args, api) => {
      const [folders, me] = await Promise.all([api.get<ApiFolder[]>('/folder'), api.get<ApiUser>('/user')]);
      const byId = new Map(folders.map((f) => [f._id, f]));
      const path = (f: ApiFolder): string => {
        const names: string[] = [];
        for (let cur: ApiFolder | undefined = f, guard = 0; cur && guard < 50; cur = cur.parentId ? byId.get(cur.parentId) : undefined, guard++) names.unshift(cur.name);
        return names.join(' / ');
      };
      return {
        items: folders.map((f) => ({ id: f._id, name: f.name, path: path(f), parentId: f.parentId, count: f.subtreeCount, directCount: f.itemCount, youManage: f.managers.includes(me._id) })),
      };
    },
  }),
];
