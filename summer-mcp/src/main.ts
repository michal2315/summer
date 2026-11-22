import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config';
import { createServer } from './server';

const MAX_BODY = 4 * 1024 * 1024;

/**
 * stdio (`--stdio`): for Claude Desktop / Claude Code launching it locally.
 * HTTP (default): POST /mcp, stateless.
 * The MCP has no sign-in of its own for now: every caller acts as the one Summer user from summerToken.
 */
async function main(): Promise<void> {
  if (process.argv.includes('--stdio')) {
    await createServer().connect(new StdioServerTransport());
    console.error(`summer-mcp (stdio) → ${config.apiUrl}`);
    return;
  }

  createHttpServer((req, res) => {
    handle(req, res).catch((e: Error) => {
      console.error('summer-mcp request failed:', e);
      if (!res.headersSent) sendJson(res, 500, rpcError(-32603, 'Internal server error'));
    });
  }).listen(config.port, () => console.log(`summer-mcp listening on :${config.port}/mcp → ${config.apiUrl}`));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/health' && req.method === 'GET') return sendJson(res, 200, { status: 'ok' });
  if (path !== '/mcp') return sendJson(res, 404, { error: 'not found' });
  // Stateless: no sessions, so no server-to-client stream (GET) and nothing to end (DELETE).
  if (req.method !== 'POST') return sendJson(res, 405, rpcError(-32000, 'Method not allowed'), { allow: 'POST' });

  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, 400, rpcError(-32700, (e as Error).message === 'too large' ? 'Request too large' : 'Parse error'));
  }

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const rpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
