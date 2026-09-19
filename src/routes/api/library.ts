import { createFileRoute } from '@tanstack/react-router';
import { json, preflight } from '@/server/api';
import { logError } from '@/server/serverLog';
import { getFolderIndex, listDesigns } from '@/server/library';

// Read-only view of the design library: designs from the table, catalogue and attribute
// definitions from the repository folder. The SCAD source stays server-side.
export const Route = createFileRoute('/api/library')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async () => {
        try {
          const designs = await listDesigns();
          const { components, attributes, evidenceLevels } = getFolderIndex();
          return json({
            designs: designs.map(({ scad: _scad, ...entry }) => entry),
            components,
            attributes,
            evidenceLevels,
          });
        } catch (err) {
          logError(err, { functionName: 'library', statusCode: 500 });
          return json({ error: 'library_unavailable' }, 500);
        }
      },
    },
  },
});
