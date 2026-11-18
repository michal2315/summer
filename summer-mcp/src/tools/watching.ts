import { z } from 'zod';
import { ApiNotificationFeedItem, ApiQuery } from '../api-types';
import { localDateTime, summaryBrief } from '../format';
import { SummerApi } from '../summer-api';
import { defineTool, ToolContext, ToolInputError } from '../tool';
import { runSearch } from './read';

const SHARED_PAGE = 30;

export const queryOut = (q: ApiQuery) => ({
  id: q._id,
  name: q.name,
  owner: q.isMine ? 'me' : q.owner.fullName,
  isShared: q.isShared,
  isFavorite: q.isMine ? q.isFavorite : undefined,
  followers: q.followers,
  search: q.search,
  alert: q.alert ? { active: q.alert.isActive, mail: q.alert.isMail, digest: q.alert.isDigest } : null,
  updated: localDateTime(q.updateDate),
});

/** A query by id: one of mine, or a shared one (looked up page by page; the API has no get-by-id). */
export async function findQuery(api: SummerApi, id: string): Promise<ApiQuery> {
  const mine = (await api.get<ApiQuery[]>('/queries')).find((q) => q._id === id);
  if (mine) return mine;
  for (let offset = 0; offset < 600; offset += SHARED_PAGE) {
    const page = await api.get<ApiQuery[]>('/queries/shared', { offset });
    const found = page.find((q) => q._id === id);
    if (found) return found;
    if (page.length < SHARED_PAGE) break;
  }
  throw new ToolInputError(`No query ${id} among your queries or the shared ones.`);
}

export function registerWatchingTools(ctx: ToolContext): void {
  defineTool(
    ctx,
    'get_notifications',
    {
      title: 'Get notifications',
      description:
        'Your notification feed, newest first: alerts from your saved queries (new summaries matching them), comments, mentions, ' +
        'being tagged, and new summaries by people you follow. Each item includes its summary in short.',
      input: {
        kinds: z.array(z.enum(['alert', 'comment', 'mention', 'tag', 'follow'])).optional().describe('Only these kinds. Default: all.'),
        unreadOnly: z.boolean().optional().describe('Only ones not yet viewed.'),
        queryId: z.string().uuid().optional().describe('Only alerts from this query.'),
        offset: z.number().int().min(0).optional().describe('Skip this many (paging).'),
      },
    },
    async ({ kinds, unreadOnly, queryId, offset }, api) => {
      const page = await api.get<{ items: ApiNotificationFeedItem[]; hasMore: boolean }>('/notifications/feed', {
        kinds,
        unread: unreadOnly,
        queryId,
        offset: offset ?? 0,
      });
      return {
        more: page.hasMore,
        items: page.items.map((n) => ({
          id: n._id,
          kind: n.kind,
          text: n.text,
          date: localDateTime(n.creationDate),
          viewed: n.isViewed,
          from: n.createdBy?.fullName,
          query: n.query && { id: n.query._id, name: n.query.name },
          summary: summaryBrief(n.summary),
        })),
      };
    },
  );

  defineTool(
    ctx,
    'list_queries',
    {
      title: 'List saved queries',
      description:
        'Saved queries (saved searches, which may also alert). `mine`: your own queries. `shared`: queries others shared, searchable by name. ' +
        'Each shows its search and your alert on it.',
      input: {
        scope: z.enum(['mine', 'shared']).optional().describe('Default: mine.'),
        text: z.string().max(120).optional().describe('shared only: part of the query name.'),
        offset: z.number().int().min(0).optional().describe(`shared only: skip this many (${SHARED_PAGE} per page).`),
      },
    },
    async ({ scope, text, offset }, api) => {
      if (scope === 'shared') {
        const page = await api.get<ApiQuery[]>('/queries/shared', { q: text ?? '', offset: offset ?? 0 });
        return { more: page.length === SHARED_PAGE, items: page.map(queryOut) };
      }
      return (await api.get<ApiQuery[]>('/queries')).map(queryOut);
    },
  );

  defineTool(
    ctx,
    'run_query',
    {
      title: 'Run saved query',
      description: 'Runs a saved query (yours or a shared one) and returns the published summaries it finds, in the query\'s own sort order.',
      input: {
        queryId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).optional().describe('Default 20.'),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ queryId, limit, offset }, api) => {
      const query = await findQuery(api, queryId);
      return { query: { id: query._id, name: query.name }, ...(await runSearch(api, query.search, { limit, offset })) };
    },
  );
}
