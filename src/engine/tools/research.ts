import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel, Tool } from 'ai';

// Research through the model provider's web search (issue #19). Provider-executed, so the
// search runs on the provider's side and its results come back as tool results the SDK
// records in the step evidence. Only an Anthropic model carries the tool; a mock or another
// provider gets none, and the agents run without research.
export function researchTools(
  model: LanguageModel,
  maxUses = 3,
): Record<string, Tool> {
  const provider = typeof model === 'string' ? '' : model.provider;
  if (!/anthropic/.test(provider)) return {};
  return {
    research: anthropic.tools.webSearch_20260209({
      maxUses,
    }) as unknown as Tool,
  };
}
