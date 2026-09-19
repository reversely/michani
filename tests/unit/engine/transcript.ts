import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import type { Session } from '@/engine/session';
import { renderSessionMarkdown } from '@/engine/run';

// Writes a session as Markdown and as a rendered PNG under docs/progress (issue #15). Every
// string is HTML-escaped before it enters the page, so transcript text cannot inject markup.

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export function renderSessionHtml(session: Session, title: string): string {
  const md = renderSessionMarkdown(session);
  const blocks = md.split('\n').map((line) => {
    if (line.startsWith('# ')) return `<h1>${escape(line.slice(2))}</h1>`;
    if (line.startsWith('## ')) return `<h2>${escape(line.slice(3))}</h2>`;
    if (line.startsWith('### ')) return `<h3>${escape(line.slice(4))}</h3>`;
    if (line.startsWith('| --- ')) return '';
    if (line.startsWith('| ')) {
      const cells = line
        .slice(2, -2)
        .split(' | ')
        .map((c) => `<td>${escape(c)}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    }
    if (line.startsWith('**Person:**'))
      return `<p class="person"><b>Person</b> ${escape(line.slice(11))}</p>`;
    if (line.startsWith('**Assistant:**'))
      return `<p class="assistant"><b>Assistant</b> ${escape(line.slice(14))}</p>`;
    if (line.startsWith('- ')) return `<li>${escape(line.slice(2))}</li>`;
    if (line.trim() === '') return '';
    return `<p>${escape(line)}</p>`;
  });
  const body = blocks
    .join('\n')
    .replace(/(<tr>[\s\S]*?<\/tr>\n?)+/g, (m) => `<table>${m}</table>`)
    .replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>
body{margin:0;padding:16px;font:14px/1.45 system-ui,sans-serif;background:#1a1a1a;color:#e8e8e8;max-width:960px;margin-inline:auto;overflow-wrap:anywhere}
h1{font-size:18px}h2{font-size:16px;margin-top:24px}h3{font-size:14px}
table{border-collapse:collapse;width:100%;margin:8px 0}td{border:1px solid #444;padding:4px 8px;vertical-align:top}
.person{background:#2a2f3a;padding:8px;border-radius:6px}.assistant{background:#22301f;padding:8px;border-radius:6px}
ul{padding-left:20px}li{margin:2px 0}
</style></head><body data-audit-center>${body}</body></html>`;
}

export async function writeTranscript(
  session: Session,
  name: string,
): Promise<{ md: string; png: string; html: string }> {
  mkdirSync('docs/progress', { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const md = `docs/progress/${stamp}-engine-${name}.md`;
  const html = `docs/progress/${stamp}-engine-${name}.html`;
  const png = `docs/progress/${stamp}-engine-${name}.png`;
  writeFileSync(md, renderSessionMarkdown(session));
  writeFileSync(html, renderSessionHtml(session, `Engine transcript: ${name}`));
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.setContent(renderSessionHtml(session, name));
  await page.screenshot({ path: png, fullPage: true });
  await browser.close();
  return { md, png, html };
}
