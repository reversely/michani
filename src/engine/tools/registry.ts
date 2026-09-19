import { tool, type Tool } from 'ai';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import { z } from 'zod';

// The engine's tool registry (issue #12). Every capability an agent may use is a named tool
// with an input schema and an implementation; agents receive a subset by name. Inputs are
// validated by the schema before the implementation runs, which is what keeps model output
// away from the file system, the renderer, and the shell.

export type EngineTool<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> = {
  name: string;
  description: string;
  input: I;
  run: (input: z.infer<I>) => Promise<O> | O;
  // How the result reaches the model when it is not plain JSON: a snapshot tool returns
  // image parts, for example. Absent means the JSON result.
  toModelOutput?: (output: O) => ToolResultOutput;
};

const registry = new Map<string, EngineTool>();

export function registerTool<I extends z.ZodTypeAny, O>(
  t: EngineTool<I, O>,
): EngineTool<I, O> {
  if (registry.has(t.name))
    throw new Error(`tool "${t.name}" is already registered`);
  registry.set(t.name, t as unknown as EngineTool);
  return t;
}

export function getTool(name: string): EngineTool {
  const t = registry.get(name);
  if (!t) throw new Error(`no tool named "${name}"`);
  return t;
}

export function listTools(): Array<{ name: string; description: string }> {
  return [...registry.values()].map((t) => ({
    name: t.name,
    description: t.description,
  }));
}

// Calls a tool by name with schema validation, for tests and for code paths that run a tool
// outside a model loop.
export async function callTool(name: string, input: unknown): Promise<unknown> {
  const t = getTool(name);
  return t.run(t.input.parse(input));
}

// Packs a named subset into the AI SDK's tool map for one agent. A name outside the registry
// is a programming error, not a runtime fallback, so it throws.
export function toolSet(names: string[]): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  for (const name of names) {
    const t = getTool(name);
    out[name] = tool({
      description: t.description,
      inputSchema: t.input,
      execute: async (input: unknown) => t.run(t.input.parse(input)),
      ...(t.toModelOutput
        ? { toModelOutput: ({ output }) => t.toModelOutput!(output) }
        : {}),
    });
  }
  return out;
}

export function clearToolsForTests(): void {
  registry.clear();
}
