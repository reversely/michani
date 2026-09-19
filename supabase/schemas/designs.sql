-- Design library table. Curated rows are seeded from the repository folder at server start;
-- generated rows are written by the generation function and never touched by the seeder.
CREATE TABLE IF NOT EXISTS "public"."designs" (
    "id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" NOT NULL,
    "part_class" "text" NOT NULL,
    "evidence_level" "text" NOT NULL,
    "licence" "text" NOT NULL,
    "scad" "text" NOT NULL,
    -- The full DesignEntry record as validated by shared/schemas/library.ts.
    "entry" "jsonb" NOT NULL,
    -- Conversation that produced a generated design; null for curated rows.
    "conversation_id" "uuid",
    CONSTRAINT "designs_source_check" CHECK ("source" IN ('curated', 'generated')),
    CONSTRAINT "designs_part_class_check" CHECK ("part_class" IN ('A', 'B', 'C'))
);

CREATE UNIQUE INDEX IF NOT EXISTS designs_pkey ON "public"."designs" USING btree (id);

ALTER TABLE "public"."designs" ADD CONSTRAINT "designs_pkey" PRIMARY KEY USING INDEX "designs_pkey";

CREATE INDEX IF NOT EXISTS designs_source_idx ON "public"."designs" USING btree (source);

-- Any signed-in user may read the library; only the service role (server) writes it.
CREATE POLICY "Authenticated users can read designs" ON "public"."designs" FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."designs" ENABLE ROW LEVEL SECURITY;
