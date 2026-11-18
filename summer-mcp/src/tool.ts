import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SummerApi, SummerApiError } from './summer-api';

type Shape = z.ZodRawShape;
type Args<S extends Shape> = z.infer<z.ZodObject<S>>;
type Out<O extends Shape> = z.infer<z.ZodObject<O>>;

/** A tool, defined once at startup; `register` adds it to a server (cheap: no schemas are built there). */
export interface Tool {
  name: string;
  register(server: McpServer, api: SummerApi): void;
}

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

/**
 * A tool whose handler returns typed data matching `output`. It goes back as `structuredContent` (which hosts can
 * validate against the advertised outputSchema), and as the same JSON in a text block for hosts that read only text.
 * Errors from Summer come back as a tool error (isError) with the server's message, so the model can correct the call
 * instead of the session failing.
 */
export function defineTool<S extends Shape, O extends Shape>(def: {
  name: string;
  title: string;
  description: string;
  input: S;
  output: O;
  write?: { destructive: boolean; idempotent?: boolean };
  run: (args: Args<S>, api: SummerApi) => Promise<Out<O>>;
}): Tool {
  const annotations: ToolAnnotations = def.write
    ? { title: def.title, readOnlyHint: false, destructiveHint: def.write.destructive, idempotentHint: def.write.idempotent ?? false, openWorldHint: false }
    : { title: def.title, ...READ };
  const config = { title: def.title, description: def.description, inputSchema: def.input, outputSchema: def.output, annotations };

  const call = async (args: Args<S>, api: SummerApi): Promise<CallToolResult> => {
    try {
      const result = (await def.run(args, api)) as Record<string, unknown>;
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (e) {
      const message = e instanceof SummerApiError || e instanceof ToolInputError ? e.message : `Unexpected error: ${(e as Error).message}`;
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  };

  return {
    name: def.name,
    // The SDK's callback type is inferred from a generic shape it can't narrow here; the input is validated against `def.input`.
    register: (server, api) => void server.registerTool(def.name, config, ((args: Args<S>) => call(args, api)) as never),
  };
}

/** A call the tool itself refuses (before reaching Summer), with a message telling the model what to fix. */
export class ToolInputError extends Error {}
