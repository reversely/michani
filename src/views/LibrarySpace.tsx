import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiUrl } from '@/services/api';

// The Library space (issue #23): every design and catalogue component the engine can draw
// on, read from /api/library. Pick a design to read its parameters and ranges. Every string
// renders as plain text; colours are the workspace role tokens.

const parameterSchema = z.object({
  id: z.string(),
  variable: z.string(),
  attributeId: z.string(),
  default: z.number(),
  min: z.number(),
  max: z.number(),
});
const designSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    source: z.string(),
    licence: z.string(),
    attribution: z.string(),
    partClass: z.string(),
    riskLabel: z.string(),
    evidenceLevel: z.string(),
    parameters: z.array(parameterSchema),
    keywords: z.array(z.string()).default([]),
  })
  .passthrough();
const componentSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    geometrySource: z
      .object({ tier: z.string(), module: z.string() })
      .passthrough()
      .optional(),
  })
  .passthrough();
const attributeSchema = z
  .object({ id: z.string(), name: z.string(), unit: z.string().optional() })
  .passthrough();
const librarySchema = z.object({
  designs: z.array(designSchema),
  components: z.array(componentSchema),
  attributes: z.array(attributeSchema),
});
type Library = z.infer<typeof librarySchema>;

const surface = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
} as const;

export function LibrarySpace() {
  const [library, setLibrary] = useState<Library>();
  const [error, setError] = useState<string>();
  const [openId, setOpenId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('library'))
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return librarySchema.parse(await r.json());
      })
      .then((lib) => {
        if (!cancelled) setLibrary(lib);
      })
      .catch(() => {
        if (!cancelled)
          setError('The library could not be loaded from the server');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const attributeName = (id: string) => {
    const a = library?.attributes.find((x) => x.id === id);
    return a ? `${a.name}${a.unit ? ` (${a.unit})` : ''}` : id;
  };
  const open = library?.designs.find((d) => d.id === openId);

  return (
    <main
      aria-label="Library"
      className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-14 lg:px-8 lg:pt-6"
    >
      <div className="ws-enter">
        <h1 className="text-lg font-semibold">Library</h1>
        <p className="text-sm" style={{ color: 'var(--ink-meta)' }}>
          {library
            ? `${library.designs.length} designs and ${library.components.length} catalogue components`
            : error
              ? ''
              : 'Loading'}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--fail)' }}>
          {error}
        </p>
      )}
      {library && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-label="Designs" className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Designs</h2>
            <ul className="flex flex-col gap-2">
              {library.designs.map((d, i) => {
                const selected = d.id === openId;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      aria-expanded={selected}
                      onClick={() => setOpenId(selected ? undefined : d.id)}
                      className="ws-enter ws-press w-full rounded-lg p-4 text-left text-sm"
                      style={{
                        ...surface,
                        borderColor: selected ? 'var(--accent)' : 'var(--line)',
                        animationDelay: `${i * 30}ms`,
                      }}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold">{d.name}</span>
                        <span
                          className="text-xs"
                          style={{ color: 'var(--ink-meta)' }}
                        >
                          class {d.partClass}
                        </span>
                      </span>
                      <span
                        className="mt-1 block"
                        style={{ color: 'var(--ink-dim)' }}
                      >
                        {d.description}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-1 text-xs">
                        {[
                          d.source,
                          d.evidenceLevel,
                          d.riskLabel,
                          d.licence,
                          `${d.parameters.length} parameters`,
                        ].map((tag) => (
                          <span
                            key={tag}
                            className="rounded px-1.5 py-0.5"
                            style={{
                              background: 'var(--surface-2)',
                              color:
                                tag === 'needs expert review'
                                  ? 'var(--warn)'
                                  : 'var(--ink-meta)',
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          <div className="flex flex-col gap-4">
            {open && (
              <section
                aria-label={`Parameters of ${open.name}`}
                className="ws-enter rounded-lg p-4 text-sm"
                style={surface}
              >
                <h2 className="font-semibold">{open.name}</h2>
                <p className="text-xs" style={{ color: 'var(--ink-meta)' }}>
                  {open.attribution}
                </p>
                <table className="mt-3 w-full text-left">
                  <thead>
                    <tr
                      className="text-xs"
                      style={{ color: 'var(--ink-meta)' }}
                    >
                      <th className="py-1 pr-2 font-medium">Parameter</th>
                      <th className="py-1 pr-2 font-medium">Attribute</th>
                      <th className="py-1 pr-2 text-right font-medium">
                        Default
                      </th>
                      <th className="py-1 text-right font-medium">Range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.parameters.map((p) => (
                      <tr
                        key={p.id}
                        style={{ borderTop: '1px solid var(--line)' }}
                      >
                        <td className="py-1 pr-2">{p.variable}</td>
                        <td
                          className="py-1 pr-2"
                          style={{ color: 'var(--ink-dim)' }}
                        >
                          {attributeName(p.attributeId)}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {p.default}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {p.min} to {p.max}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            <section
              aria-label="Catalogue components"
              className="ws-enter rounded-lg p-4 text-sm"
              style={surface}
            >
              <h2 className="font-semibold">Catalogue components</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {library.components.map((c) => (
                  <li key={c.id}>
                    <p>{c.label}</p>
                    <p className="text-xs" style={{ color: 'var(--ink-meta)' }}>
                      {c.geometrySource
                        ? `${c.geometrySource.tier} ${c.geometrySource.module}`
                        : 'measurements only'}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
