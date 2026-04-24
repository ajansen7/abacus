import { Dashboard } from '@/components/Dashboard';
import { getState, type MarathonState } from '@/lib/abacus';

export const dynamic = 'force-dynamic';

export default async function Page() {
  let initial: MarathonState | null = null;
  try {
    initial = await getState();
  } catch {
    // SSR reach to abacus failed — fall back to client fetch so the page still renders.
  }
  return <Dashboard initial={initial} />;
}
