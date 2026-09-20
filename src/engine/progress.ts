// Progress events a turn emits while it runs (issue #27), so a screen can show the stage,
// the build in flight, the exact prompt CADAM received, and the views each build produced.
// A generate event with views is a preview of the item being built.

export type ProgressStage = 'plan' | 'generate' | 'draft' | 'verify' | 'done';

export type ProgressView = { label: string; pngBase64: string };

export type ProgressEvent = {
  at: string;
  stage: ProgressStage;
  // One clause, in the person's terms.
  detail: string;
  attempt?: number;
  build?: number;
  agentId?: string;
  // The full system and user prompt sent to CADAM for this attempt.
  prompt?: { system: string; user: string };
  views?: ProgressView[];
};

export type OnProgress = (event: Omit<ProgressEvent, 'at'>) => void;

export const noProgress: OnProgress = () => {};

export function viewsToProgress(
  views: Array<{ label: string; png: Uint8Array }>,
): ProgressView[] {
  return views.map((v) => ({
    label: v.label,
    pngBase64: Buffer.from(v.png).toString('base64'),
  }));
}
