import { z } from 'zod';
import { ApiNotificationFeedItem, ApiQuery } from '../api-types';
import { localDateTime, summaryBrief } from '../format';
import { id, query, QueryOut, searchPage, summaryBrief as summaryBriefSchema } from '../schemas';
import { defineTool, Tool } from '../tool';
import { runSearch, UNTRUSTED } from './read';

const SHARED_PAGE = 30;

export const queryOut = (q: ApiQuery): QueryOut => ({
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

export const watchingTools: Tool[] = [
  defineTool({
    name: 'get_notifications',
    title: 'Get notifications',
    description:
      'Your notification feed, newest first: alerts from your saved queries (new summaries matching them), comments, mentions, ' +
      `being tagged, and new summaries by people you follow. Each item includes its summary in short. ${UNTRUSTED}`,
    input: {
      kinds: z.array(z.enum(['alert', 'comment', 'mention', 'tag', 'follow'])).optional().describe('Only these kinds. Default: all.'),
      unreadOnly: z.boolean().optional().describe('Only ones not yet viewed.'),
      queryId: id.optional().describe('Only alerts from this query.'),
      offset: z.number().int().min(0).optional().describe('Skip this many (paging).'),
    },
    output: {
      more: z.boolean(),
      items: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(['alert', 'comment', 'mention', 'tag', 'follow']),
          text: z.string(),
          date: z.string(),
          viewed: z.boolean(),
          from: z.string().optional(),
          query: z.object({ id: z.string(), name: z.string() }).optional(),
          summary: summaryBriefSchema,
        }),
      ),
    },
    run: async ({ kinds, unreadOnly, queryId, offset }, api) => {
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
  }),

  defineTool({
    name: 'list_queries',
    title: 'List saved queries',
    description:
      'Saved queries (saved searches, which may also alert). `mine`: your own queries, and shared ones you alert on. ' +
      '`shared`: queries others shared, searchable by name. Each shows its search and your alert on it.',
    input: {
      scope: z.enum(['mine', 'shared']).optional().describe('Default: mine.'),
      text: z.string().max(120).optional().describe('shared only: part of the query name.'),
      offset: z.number().int().min(0).optional().describe(`shared only: skip this many (${SHARED_PAGE} per page).`),
    },
    output: { more: z.boolean(), items: z.array(query) },
    run: async ({ scope, text, offset }, api) => {
      if (scope === 'shared') {
        const page = await api.get<ApiQuery[]>('/queries/shared', { q: text ?? '', offset: offset ?? 0 });
        return { more: page.length === SHARED_PAGE, items: page.map(queryOut) };
      }
      return { more: false, items: (await api.get<ApiQuery[]>('/queries')).map(queryOut) };
    },
  }),

  defineTool({
    name: 'run_query',
    title: 'Run saved query',
    description: `Runs a saved query (yours or a shared one) and returns the published summaries it finds, in the query's own sort order. ${UNTRUSTED}`,
    input: {
      queryId: id,
      limit: z.number().int().min(1).max(100).optional().describe('Default 20.'),
      offset: z.number().int().min(0).optional(),
    },
    output: { query: z.object({ id: z.string(), name: z.string() }), ...searchPage },
    run: async ({ queryId, limit, offset }, api) => {
      const q = await api.get<ApiQuery>(`/queries/${queryId}`);
      return { query: { id: q._id, name: q.name }, ...(await runSearch(api, q.search, { limit, offset })) };
    },
  }),
];
