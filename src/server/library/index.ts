import { loadLibrary, type LibraryIndex } from '@shared/library/loader';
import { designEntrySchema, type DesignEntry } from '@shared/schemas/library';
import { getServiceRoleSupabaseClient } from '@/server/supabaseClient';
import { logError } from '@/server/serverLog';

// Server-side view of the design library. The repository folder is the source of truth for
// curated designs; the `designs` table holds them plus any generated designs, and the agents
// read the table (PRD R13, R19).

export type DesignRow = DesignEntry & { scad: string };

let folderIndex: LibraryIndex | null = null;
let seeded = false;

export function getFolderIndex(root = 'library'): LibraryIndex {
  folderIndex ??= loadLibrary(root);
  return folderIndex;
}

// Upserts every curated design into the table. Rows whose source is 'generated' are never
// touched, so a restart cannot erase a design the generation function saved.
export async function seedDesigns(root = 'library'): Promise<number> {
  const index = getFolderIndex(root);
  const supabase = getServiceRoleSupabaseClient();
  const rows = index.designs.map(({ scad, ...entry }) => ({
    id: entry.id,
    source: 'curated',
    part_class: entry.partClass,
    evidence_level: entry.evidenceLevel,
    licence: entry.licence,
    scad,
    entry,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('designs')
    .upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`seeding designs failed: ${error.message}`);
  seeded = true;
  return rows.length;
}

// Returns every design the agents may select. Seeds once per process, then reads the table.
// If the table is unreachable the folder index still serves curated designs, so a local run
// without the database degrades to the curated library rather than failing.
export async function listDesigns(root = 'library'): Promise<DesignRow[]> {
  try {
    if (!seeded) await seedDesigns(root);
    const supabase = getServiceRoleSupabaseClient();
    const { data, error } = await supabase
      .from('designs')
      .select('entry, scad');
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      ...designEntrySchema.parse(row.entry),
      scad: row.scad,
    }));
  } catch (err) {
    logError(err, { functionName: 'listDesigns', statusCode: 500 });
    return getFolderIndex(root).designs;
  }
}

export async function saveGeneratedDesign(
  entry: DesignEntry,
  scad: string,
  conversationId: string,
): Promise<void> {
  const supabase = getServiceRoleSupabaseClient();
  const { error } = await supabase.from('designs').upsert(
    {
      id: entry.id,
      source: 'generated',
      part_class: entry.partClass,
      evidence_level: 'untested',
      licence: entry.licence,
      scad,
      entry: { ...entry, source: 'generated', evidenceLevel: 'untested' },
      conversation_id: conversationId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error)
    throw new Error(`saving generated design failed: ${error.message}`);
}
