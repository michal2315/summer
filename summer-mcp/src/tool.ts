import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SummerApi, SummerApiError } from './summer-api';

type Shape = z.ZodRawShape;
type Args<S extends Shape> = z.infer<z.ZodObject<S>>;

/** What every tool module gets: the server to register on and the API client acting as the caller. */
export interface ToolContext {
  server: McpServer;
  api: SummerApi;
}

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

/**
 * Registers a tool whose handler returns plain data; it is sent back as JSON text. Errors from Summer come back as a
 * tool error (isError) with the server's message, so the model can correct the call instead of the session failing.
 */
export function defineTool<S extends Shape>(
  { server, api }: ToolContext,
  name: string,
  def: { title: string; description: string; input: S; write?: { destructive: boolean; idempotent?: boolean } },
  run: (args: Args<S>, api: SummerApi) => Promise<unknown>,
): void {
  const annotations: ToolAnnotations = def.write
    ? { title: def.title, readOnlyHint: false, destructiveHint: def.write.destructive, idempotentHint: def.write.idempotent ?? false, openWorldHint: false }
    : { title: def.title, ...READ };

  const handler = async (args: Args<S>): Promise<CallToolResult> => {
    try {
      const result = await run(args, api);
      return { content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }) }] };
    } catch (e) {
      const message = e instanceof SummerApiError || e instanceof ToolInputError ? e.message : `Unexpected error: ${(e as Error).message}`;
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  };
  // The SDK's callback type is inferred from a generic shape it can't narrow here; the input is validated against `def.input`.
  server.registerTool(name, { title: def.title, description: def.description, inputSchema: def.input, annotations }, handler as never);
}

/** A call the tool itself refuses (before reaching Summer), with a message telling the model what to fix. */
export class ToolInputError extends Error {}
