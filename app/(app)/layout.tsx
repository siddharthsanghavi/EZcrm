import { redirect } from 'next/navigation';
import { currentProfile, serverClient } from '@/lib/supabase';
import { NavRail, type RailCounts } from '@/components/nav-rail';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Signed in but not on the allowlist means no profile row, and RLS would show
  // them an empty app. Say so plainly instead.
  const profile = await currentProfile();
  if (!profile) redirect('/no-access');

  const supabase = await serverClient();

  // Counts for the rail. `head: true` fetches no rows, so these are four cheap
  // COUNT queries — worth it to make a destination worth clicking. Open tasks
  // only: a rail badge counting finished work would be noise.
  const [companies, contacts, tasks, members, deletions] = await Promise.all([
    supabase.from('companies').select('id', { count: 'exact', head: true }),
    supabase.from('contacts').select('id', { count: 'exact', head: true }),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('done', false),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase
      .from('deletion_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ]);

  const counts: RailCounts = {
    companies: companies.count,
    contacts: contacts.count,
    tasks: tasks.count,
    members: members.count,
    // Zero pending is the normal state, and a permanent "0" is noise.
    deletions: deletions.count || null,
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <NavRail profile={profile} counts={counts} />
      <main className="min-w-0 flex-1 px-5 py-7 sm:px-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
