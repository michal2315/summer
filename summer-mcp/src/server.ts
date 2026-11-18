import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SummerApi } from './summer-api';
import { registerLookupTools } from './tools/lookup';
import { registerReadTools } from './tools/read';
import { registerWatchingTools } from './tools/watching';
import { registerWritingTools } from './tools/writing';

const INSTRUCTIONS = `Summer is a knowledge base of summaries (תמציות). You act as the signed-in user and see only what they may see.
- Summaries have a title, content, notes, an event date, a content type with its own fields, labels, permission groups, tagged users, folders and comments.
- Kinds: summary (regular), running (תמצית רצף: a running summary over a date range) and sumaroon (תמציתונית: an entry inside a running summary).
- Use get_catalog, find_users, find_capsules and list_folders to turn names into the ids and exact names other tools need.
- search_summaries returns short results; open the ones you need with get_summary.
- New summaries are saved as drafts unless the user asks to publish. Every summary except a sumaroon needs at least one permission group the user belongs to: ask which when it is not clear.`;

/** One MCP server (one per HTTP request, or one per stdio process), acting as the configured Summer user. */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'summer', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  const ctx = { server, api: new SummerApi() };
  registerLookupTools(ctx);
  registerReadTools(ctx);
  registerWatchingTools(ctx);
  registerWritingTools(ctx);
  return server;
}
