import { generateText, Output, type LanguageModel } from 'ai';
import parseParameters from '@shared/parseParameters';
import type { Parameter } from '@shared/types';
import type { StlSummary } from '@shared/stl';
import { parametricArtifactSchema } from '@shared/chatAi';
import { PARAMETRIC_AGENT_PROMPT } from '@/server/aiChat';
import { renderScadToStl } from '@/server/render/openscad';

// CADAM as an external tool (issue #12). The engine calls CADAM for three things and nothing
// else: generate OpenSCAD from a brief, render OpenSCAD with parameter overrides, and extract
// the Customizer parameters from OpenSCAD text. This interface has one implementation today,
// against the fork's own modules; a second one can call CADAM over HTTP without any agent
// noticing.

export type CadamGeneration = { title: string; version: string; code: string };

export type CadamRender = {
  exitCode: number;
  stl: Uint8Array | null;
  summary: StlSummary | null;
  ms: number;
  log: string;
};

export interface CadamAdapter {
  generate(brief: string, model: LanguageModel): Promise<CadamGeneration>;
  render(scad: string, overrides: Record<string, number>): Promise<CadamRender>;
  parameters(scad: string): Parameter[];
}

export const localCadam: CadamAdapter = {
  async generate(brief, model) {
    const result = await generateText({
      model,
      system: PARAMETRIC_AGENT_PROMPT,
      prompt: brief,
      output: Output.object({ schema: parametricArtifactSchema }),
    });
    return parametricArtifactSchema.parse(result.output);
  },
  render(scad, overrides) {
    return renderScadToStl(scad, overrides);
  },
  parameters(scad) {
    return parseParameters(scad);
  },
};

let current: CadamAdapter = localCadam;

export function cadam(): CadamAdapter {
  return current;
}

export function useCadamAdapter(adapter: CadamAdapter): void {
  current = adapter;
}
