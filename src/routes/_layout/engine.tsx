import { createFileRoute } from '@tanstack/react-router';
import { EngineView } from '@/views/EngineView';

export const Route = createFileRoute('/_layout/engine')({
  component: EngineView,
});
