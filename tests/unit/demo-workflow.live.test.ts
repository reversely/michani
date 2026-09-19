import { describe, it, expect } from 'vitest';
import { createAnthropic } from '@ai-sdk/anthropic';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadLibrary } from '@shared/library/loader';
import { runRequirementsAgent } from '@/server/agents/requirements';
import {
  applyCandidateToPlan,
  runLibraryAgent,
  toIndexEntry,
} from '@/server/agents/library';
import { runAdaptationLoop } from '@/server/loop/run';
import { buildReport, renderMarkdown } from '@/server/report/build';
import { buildPackageFiles } from '@/utils/packageUtils';
import { renderScadToStl } from '@/server/render/openscad';

// Scenario D1 as one live sequence: request -> requirements and plan -> library selection ->
// plan confirmation (the user's click, simulated) -> draft, render, verify -> report -> package.
// Writes the package files to docs/progress/d1-package/ so a person can open them.
const live =
  process.env.LIVE_AGENT_TESTS === '1' && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!live)('demo workflow (live, D1 end to end)', () => {
  it('runs from request to package', async () => {
    const started = Date.now();
    const { designs, attributes, components } = loadLibrary('library');
    const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
      'claude-sonnet-5',
    );
    const conversationId = 'live-d1-workflow';
    const request =
      'Print tweezers 120 mm long with a 3 mm tip, 2 mm thick arms, a 12 mm gap at rest, and 14 mm wide at the bridge, for general workshop use.';
    const timings: Record<string, number> = {};

    // 1. Requirements and plan (the library agent has not chosen yet, so the candidate is the
    //    class A default; the plan is rewritten after selection).
    let t = Date.now();
    const req = await runRequirementsAgent({
      model,
      request,
      design: designs.find((d) => d.id === 'tweezers')!,
      attributes,
      catalogue: components,
      conversationId,
    });
    timings.requirements = Date.now() - t;
    expect(req.kind).toBe('specification');
    if (req.kind !== 'specification') return;

    // 2. Library selection.
    t = Date.now();
    const lib = await runLibraryAgent({
      model,
      specification: req.specification,
      index: designs.map(toIndexEntry),
      catalogue: components,
    });
    timings.library = Date.now() - t;
    expect(lib.kind).toBe('candidates');
    if (lib.kind !== 'candidates') return;
    expect(lib.candidates[0].designId).toBe('tweezers');
    const planned = applyCandidateToPlan(req.plan, lib.candidates[0]);

    // 3. The user confirms the plan.
    const plan = { ...planned, confirmed: true };
    const design = designs.find((d) => d.id === plan.candidateDesignId)!;

    // 4. Draft, render, verify.
    t = Date.now();
    const loop = await runAdaptationLoop({
      model,
      plan,
      specification: req.specification,
      design,
      attributes,
      fallbackDesign: designs.find((d) => d.id === lib.candidates[1]?.designId),
    });
    timings.loop = Date.now() - t;
    expect(loop.ok, loop.message).toBe(true);
    expect(loop.report?.failed).toEqual([]);

    // 5. Report and package.
    const record = buildReport({
      design,
      specification: req.specification,
      plan,
      values: loop.values!,
      report: loop.report!,
      attempts: loop.attempts.length,
    });
    const markdown = renderMarkdown(record);
    const render = await renderScadToStl(design.scad, loop.values!);
    const files = buildPackageFiles({
      stl: render.stl!,
      scad: design.scad,
      values: loop.values!,
      report: record,
      reportMarkdown: markdown,
    });
    const dir = 'docs/progress/d1-package';
    mkdirSync(dir, { recursive: true });
    for (const f of files) writeFileSync(`${dir}/${f.name}`, f.content);
    timings.total = Date.now() - started;
    writeFileSync(
      `${dir}/TIMINGS.md`,
      `# D1 live run ${new Date().toISOString()}\n\n| Step | ms |\n| --- | --- |\n${Object.entries(
        timings,
      )
        .map(([k, v]) => `| ${k} | ${v} |`)
        .join(
          '\n',
        )}\n\nChecks: ${record.checks.map((c) => `${c.checkId} ${c.result}`).join(', ')}. Did not run: ${record.didNotRun.map((d) => d.checkId).join(', ')}.\n`,
    );
    console.log(
      `live D1 workflow: ${JSON.stringify(timings)}; checks=${record.checks.map((c) => `${c.checkId}:${c.result}`).join(',')}`,
    );
    expect(files.map((f) => f.name)).toContain('report.md');
    expect(record.design.riskLabel).toBe('general');
    expect(timings.total).toBeLessThan(180_000);
  }, 240_000);
});
