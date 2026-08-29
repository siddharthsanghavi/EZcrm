import Link from 'next/link';
import {
  approveDeletionRequest,
  declineDeletionRequest,
  withdrawDeletionRequest,
} from '@/app/actions';
import { ConfirmButton } from '@/components/confirm-button';
import { currentProfile, serverClient } from '@/lib/supabase';
import { canWrite, displayName, sinceLabel } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Search = { requested?: string };

type Person = { full_name: string | null; email: string } | null;

/**
 * Deletion requests and the deletion log.
 *
 * Both halves are on one page on purpose: the question "why is this company
 * gone?" and the question "should this company go?" are the same question at
 * different times, and an admin deciding the second one wants to see what has
 * already been decided.
 */
export default async function DeletionsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { requested } = await searchParams;
  const me = await currentProfile();
  const supabase = await serverClient();

  const [{ data: pending }, { data: decided }, { data: log }] = await Promise.all([
    supabase
      .from('deletion_requests')
      .select('*, companies(id, name, city, status), profiles!deletion_requests_requested_by_fkey(full_name, email)')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    supabase
      .from('deletion_requests')
      .select('*, companies(id, name), profiles!deletion_requests_requested_by_fkey(full_name, email)')
      .neq('status', 'pending')
      .order('decided_at', { ascending: false })
      .limit(20),
    supabase
      .from('company_deletions')
      .select('*, profiles!company_deletions_deleted_by_fkey(full_name, email)')
      .order('deleted_at', { ascending: false })
      .limit(50),
  ]);

  const isAdmin = me?.role === 'admin';
  const writable = canWrite(me);
  const queue = pending ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deletions</h1>
        <p className="mt-1 text-sm text-black/55">
          {isAdmin
            ? 'Requests waiting on you, and every company that has been deleted.'
            : writable
              ? 'Deletions are done by admins. Ask here, and see what has already gone.'
              : 'What has been deleted, and what has been asked for.'}
        </p>
      </div>

      {requested && (
        <p className="card border-black/10 px-4 py-2.5 text-sm">
          Filed {requested} deletion request{requested === '1' ? '' : 's'}. An admin decides from
          this page.
        </p>
      )}

      <section className="card overflow-hidden">
        <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">
          Waiting for a decision · {queue.length}
        </h2>

        {queue.length > 0 ? (
          <ul className="divide-y divide-black/5">
            {queue.map((r) => {
              const co = r.companies as unknown as { id: string; name: string; city: string | null } | null;
              const who = r.profiles as unknown as Person;
              const mine = writable && r.requested_by === me?.id;

              return (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    {co ? (
                      <Link href={`/companies/${co.id}`} className="font-medium hover:underline">
                        {co.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-black/40">(already gone)</span>
                    )}
                    <span className="text-xs text-black/45">
                      {displayName(who)} · {sinceLabel(r.requested_at)}
                    </span>
                  </div>

                  {r.reason ? (
                    <p className="mt-1 text-sm text-black/70">{r.reason}</p>
                  ) : (
                    <p className="mt-1 text-sm text-black/40">No reason given.</p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {isAdmin && co && (
                      <>
                        <form action={approveDeletionRequest}>
                          <input type="hidden" name="company_id" value={co.id} />
                          <ConfirmButton
                            message={`Delete ${co.name}, along with its contacts, activity and tasks?\n\nThis cannot be undone.`}
                            className="btn py-1.5 border border-danger/40 text-danger hover:bg-danger/10"
                          >
                            Approve and delete
                          </ConfirmButton>
                        </form>

                        <form action={declineDeletionRequest} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={r.id} />
                          <input
                            name="note"
                            placeholder="Why not (optional)"
                            className="field w-48 py-1.5"
                            aria-label="Reason for declining"
                          />
                          <button className="btn-ghost py-1.5">Decline</button>
                        </form>
                      </>
                    )}

                    {mine && (
                      <form action={withdrawDeletionRequest}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="btn-ghost py-1.5">Withdraw</button>
                      </form>
                    )}

                    {!isAdmin && !mine && (
                      <span className="text-xs text-black/40">Waiting on an admin.</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-black/45">Nothing waiting.</p>
        )}
      </section>

      {(decided ?? []).length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">
            Declined and withdrawn
          </h2>
          <ul className="divide-y divide-black/5">
            {(decided ?? []).map((r) => {
              const co = r.companies as unknown as { id: string; name: string } | null;
              return (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                  <span>
                    {co ? (
                      <Link href={`/companies/${co.id}`} className="font-medium hover:underline">
                        {co.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-black/40">(already gone)</span>
                    )}
                    <span className="text-black/45"> · {r.status}</span>
                    {r.decision_note && (
                      <span className="text-black/55"> — {r.decision_note}</span>
                    )}
                  </span>
                  <span className="text-xs text-black/40">{sinceLabel(r.decided_at)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card overflow-hidden">
        <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">
          Deleted companies · {(log ?? []).length}
        </h2>

        {(log ?? []).length > 0 ? (
          <ul className="divide-y divide-black/5">
            {(log ?? []).map((d) => {
              const by = d.profiles as unknown as Person;
              const snap = (d.snapshot ?? {}) as Record<string, string | null>;
              const where = [snap.type, snap.city, snap.region].filter(Boolean).join(' · ');

              return (
                <li key={d.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{d.company_name}</span>
                    <span className="text-xs text-black/40">{sinceLabel(d.deleted_at)}</span>
                  </div>
                  {where && <div className="mt-0.5 text-xs text-black/45">{where}</div>}
                  <div className="mt-1 text-xs text-black/50">
                    Deleted by {displayName(by)}
                    {d.request_reason && <> · asked for because: {d.request_reason}</>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-black/45">
            Nothing has been deleted. This log starts from the day the feature went in — anything
            removed before that left no trace.
          </p>
        )}
      </section>
    </div>
  );
}
