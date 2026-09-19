import { createFileRoute } from '@tanstack/react-router';
import { DemoView } from '@/views/DemoView';

export const Route = createFileRoute('/_layout/_auth/demo')({
  component: DemoView,
});
