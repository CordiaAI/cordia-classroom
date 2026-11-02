// Registering a tool: its schemas and annotations, the per-student rate limit (120 read and 30 write
// calls a minute, mcp_take_call) and the audit log (mcp_log_tool_call: tool, status, error code and
// time taken; never arguments or results).
import * as z from 'zod';
import { errorCode, failure } from './output.mjs';

export async function guarded(ctx, tool, kind, run) {
  const started = Date.now();
  let status = 'ok';
  let code = null;
  try {
    if ((await ctx.takeCall(kind)) === false) {
      status = 'rate_limited';
      code = 'rate_limited';
      return failure(kind === 'write'
        ? 'Too many changes in a minute (30 at most). Wait a minute, then try again.'
        : 'Too many requests in a minute (120 at most). Wait a minute, then try again.', 'rate_limited');
    }
    await ctx.load();
    const result = await run();
    if (result?.isError) {
      status = 'error';
      code = errorCode(result);
    }
    return result;
  } catch {
    status = 'error';
    code = 'exception';
    return failure('Something went wrong in Cordia. Try again in a moment.');
  } finally {
    await ctx.logCall(tool.name, status, code, Date.now() - started);
  }
}

export function registerTools(server, ctx, tools, annotations, kind) {
  for (const tool of tools) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: z.object(tool.input).strict(),
      outputSchema: z.object(tool.output),
      annotations: { title: tool.title, ...annotations, ...(tool.annotations || {}) },
    }, async args => guarded(ctx, tool, kind, () => tool.run(ctx, args)));
  }
}
