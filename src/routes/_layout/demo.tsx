import { createFileRoute } from '@tanstack/react-router';
import { EngineView } from '@/views/EngineView';

// The engine's conversation screen keeps the /demo path people already have open.
export const Route = createFileRoute('/_layout/demo')({
  component: EngineView,
});
