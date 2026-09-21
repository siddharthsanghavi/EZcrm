import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentProfile, serverClient } from '@/lib/supabase';
import {
  deleteCompany,
  requestCompanyDeletion,
  setCompanyArchived,
  withdrawDeletionRequest,
} from '@/app/actions';
import { ConfirmButton } from '@/components/confirm-button';
import {
  STATUS_LABELS,
  STATUS_STYLES,
  STATUSES,
  TIER_STYLES,
  canWrite,
  displayName,
  isCold,
  money,
  primaryLocation,
  sinceLabel,
  type Company,
  type CompanyLocation,
  type Status,
} from '@/lib/types';
import { CompanyForm } from '@/components/company-form';
import { OwnerPicker } from '@/components/owner-picker';
import { TierPicker } from '@/components/tier-picker';
import { ActivityComposer } from '@/components/activity-composer';
import { ContactForm } from '@/components/contact-form';
import { ContactTree } from '@/components/contact-tree';
import { AttachContact, type UnlinkedContact } from '@/components/attach-contact';
import { ColdEmail } from '@/components/cold-email';
import { Attachments, type AttachmentRow } from '@/components/attachments';
import { LocationsPanel } from '@/components/locations-panel';
import { StatusPicker } from '@/components/status-picker';
import { QuickTaskForm } from '@/components/quick-task-form';
import { TaskRow } from '@/components/task-row';
import { ActivityFeed } from '@/components/activity-feed';
import { loadFeed } from '@/lib/audit';
import { loadClubDetails, loadRottingRules, loadTemplates } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;
  const supabase = await serverClient();

  const { data: company } = await supabase.from('companies').select('*').eq('id', id).maybeSingle();
  if (!company) notFound();

  const [
    { data: locations },
    { data: contacts },
    { data: unlinked },
    { data: activities },
    { data: tasks },
    { data: members },
    history,
    { data: request },
    me,
    templates,
    club,
    rotting,
    { data: files },
  ] = await Promise.all([
    supabase
      .from('company_locations')
      .select('id, label, address, city, region, county, latitude, geo_precision, is_primary')
      .eq('company_id', id)
      // Primary first, then whatever order the club put them in.
      .order('is_primary', { ascending: false })
      .order('sort')
      .order('created_at'),
    supabase.from('contacts').select('*').eq('company_id', id).order('created_at'),
    // People already in the CRM who belong to no company — usually a contacts
    // CSV whose `company` column matched nothing. Capped: this is a picker, and
    // a club with hundreds of orphans has an import problem, not a UI problem.
    supabase
      .from('contacts')
      .select('id, first_name, last_name, title, email')
      .is('company_id', null)
      .order('first_name')
      .limit(200),
    supabase
      .from('activities')
      .select('*, profiles(full_name, email)')
      .eq('company_id', id)
      .order('occurred_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('id, title, due_date, done, company_id')
      .eq('company_id', id)
      .order('done')
      .order('due_date', { nullsFirst: false }),
    supabase.from('profiles').select('id, full_name, email').order('email'),
    // The company's own slice of the activity feed — status moves, edits,
    // contacts, tasks and outreach, in the order they happened.
    loadFeed({ companyId: id, limit: 30 }),
    supabase
      .from('deletion_requests')
      .select('id, reason, requested_by, requested_at, profiles!deletion_requests_requested_by_fkey(full_name, email)')
      .eq('company_id', id)
      .eq('status', 'pending')
      .maybeSingle(),
    currentProfile(),
    loadTemplates(),
    loadClubDetails(),
    loadRottingRules(),
    supabase
      .from('attachments')
      .select('*, profiles(full_name, email)')
      .eq('company_id', id)
      .order('created_at', { ascending: false }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const c = company as Company;
  type LocationRow = Pick<
    CompanyLocation,
    'id' | 'label' | 'address' | 'city' | 'region' | 'county' | 'latitude' | 'geo_precision' | 'is_primary'
  >;
  const places = (locations ?? []) as LocationRow[];
  const place = primaryLocation(places);
  const isAdmin = me?.role === 'admin';
  const writable = canWrite(me);
  const pending = request as
    | { id: string; reason: string | null; requested_by: string | null; requested_at: string; profiles: unknown }
    | null;

  if (edit && !writable) redirect(`/companies/${id}`);

  if (edit) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href={`/companies/${id}`} className="text-sm text-black/50 hover:text-ink">
          ← {c.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit company</h1>
        <CompanyForm company={c} location={place} />

        {!c.archived_at && (
          <form action={setCompanyArchived} className="card p-5">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="archived" value="true" />
            <h2 className="text-sm font-semibold">Archive this company</h2>
            <p className="mt-1 text-sm text-black/55">
              Takes it off the working list and out of the pipeline, keeping the contacts, the
              history and the files. Reversible from the company&apos;s own page. This is what you
              want at the end of a season — deleting is not.
            </p>
            <button className="btn mt-3 border border-black/15">Archive {c.name}</button>
          </form>
        )}

        {isAdmin ? (
          <form action={deleteCompany} className="card border-danger/30 p-5">
            <input type="hidden" name="id" value={id} />
            <h2 className="text-sm font-semibold text-danger">Delete this company</h2>
            <p className="mt-1 text-sm text-black/55">
              Removes its contacts, activity, and tasks too. This can&apos;t be undone — a line in
              the <Link href="/deletions" className="underline">deletion log</Link> is all that
              survives.
            </p>
            <ConfirmButton
              message={`Delete ${c.name}, along with its contacts, activity and tasks?\n\nThis cannot be undone.`}
              className="btn mt-3 border border-danger/40 text-danger hover:bg-danger/10"
            >
              Delete {c.name}
            </ConfirmButton>
          </form>
        ) : pending ? (
          <div className="card p-5">
            <h2 className="text-sm font-semibold">Deletion requested</h2>
            <p className="mt-1 text-sm text-black/55">
              Waiting for an admin to decide. See{' '}
              <Link href="/deletions" className="underline">
                Deletions
              </Link>
              .
            </p>
            {pending.requested_by === me?.id && (
              <form action={withdrawDeletionRequest} className="mt-3">
                <input type="hidden" name="id" value={pending.id} />
                <button className="btn-ghost">Withdraw the request</button>
              </form>
            )}
          </div>
        ) : (
          /* Members cannot delete — RLS says so — so the honest control here is
             the one that asks. */
          <form action={requestCompanyDeletion} className="card p-5">
            <input type="hidden" name="id" value={id} />
            <h2 className="text-sm font-semibold">Request deletion</h2>
            <p className="mt-1 text-sm text-black/55">
              An admin has to approve it. Saying why makes that a two-second decision rather than a
              conversation.
            </p>
            <textarea
              name="reason"
              rows={2}
              placeholder="Duplicate of… / closed down / never a real prospect"
              className="field mt-3 w-full"
            />
            <button className="btn mt-3 border border-black/15">Request deletion</button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/companies" className="text-sm text-black/50 hover:text-ink">
          ← Companies
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-black/55">
              {c.website && (
                <a
                  href={c.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-ink"
                >
                  {c.website.replace(/^https?:\/\//, '')}
                </a>
              )}
              {c.industry && <span>{c.industry}</span>}
              {c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}
              {c.tier && <span className={`chip ${TIER_STYLES[c.tier] ?? ''}`}>{c.tier}</span>}
              {(c.interest ?? []).map((i) => (
                <span key={i} className="chip bg-black/[0.05] text-black/60">
                  {i}
                </span>
              ))}
            </div>

            <div className="mt-1 text-sm text-black/45">
              {[c.type, [place?.city, place?.region].filter(Boolean).join(' · ')]
                .filter(Boolean)
                .join(' — ')}
              {places.length > 1 && ` · ${places.length} locations`}
              {c.employees ? ` · ~${c.employees.toLocaleString()} employees` : ''}
              {c.amount !== null && (
                <>
                  {' · '}
                  <span className="font-medium text-black/70">{money(c.amount)}</span>
                  {c.close_date && ` by ${new Date(c.close_date).toLocaleDateString()}`}
                </>
              )}
            </div>

            <div className="mt-1 text-sm">
              <span className="text-black/45">Assigned to </span>
              <span className={c.owner_id ? 'font-medium' : 'text-black/40'}>
                {displayName((members ?? []).find((m) => m.id === c.owner_id))}
              </span>
              <span className="text-black/45"> · last touched </span>
              <span
                className={
                  isCold(c.status, c.last_touch_at, rotting) ? 'font-medium text-warn' : 'font-medium'
                }
              >
                {sinceLabel(c.last_touch_at)}
              </span>
            </div>
          </div>

          {writable ? (
            <div className="flex items-center gap-2">
              <StatusPicker companyId={id} status={c.status} />
              <OwnerPicker companyId={id} ownerId={c.owner_id} members={members ?? []} />
              <TierPicker companyId={id} tier={c.tier} />
              <Link href={`/companies/${id}?edit=1`} className="btn-ghost py-1.5">
                Edit
              </Link>
            </div>
          ) : (
            /* A viewer still needs to see the status; it just isn't a control. */
            <span className={`chip ${STATUS_STYLES[c.status as Status]}`}>
              {STATUS_LABELS[c.status as Status]}
            </span>
          )}
        </div>
      </div>

      {c.archived_at && (
        <div className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
          <span>
            <span className="font-medium">Archived</span>
            <span className="text-black/55"> — off the working list since {new Date(c.archived_at).toLocaleDateString()}. Nothing was deleted.</span>
          </span>
          {writable && (
            <form action={setCompanyArchived}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="archived" value="false" />
              <button className="btn-ghost py-1.5">Restore</button>
            </form>
          )}
        </div>
      )}

      {/* Anyone opening this company should know it is on its way out before
          they spend twenty minutes logging a call against it. */}
      {pending && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-warn/40 px-5 py-3 text-sm">
          <span>
            <span className="font-medium">Deletion requested</span>
            <span className="text-black/55">
              {' '}
              by {displayName(pending.profiles as { full_name: string | null; email: string } | null)}
              {pending.reason && <> — {pending.reason}</>}
            </span>
          </span>
          <Link href="/deletions" className="btn-ghost py-1.5">
            {isAdmin ? 'Decide' : 'See requests'}
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {c.notes && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold">Notes</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-black/70">{c.notes}</p>
            </section>
          )}

          <LocationsPanel companyId={id} locations={places} writable={writable} />

          {/* Drafting is reading — a viewer can prepare an email for somebody
              else to send, and only "Log as sent" writes. */}
          <section className="card p-5">
            <h2 className="text-sm font-semibold">Cold email</h2>
            <p className="mt-1 text-sm text-black/55">
              A starting point, not a finished letter. Edit it before you send it.
            </p>
            <div className="mt-3">
              <ColdEmail
                company={{ ...c, city: place?.city ?? null }}
                contacts={(contacts ?? []) as never}
                sender={{ name: displayName(me), email: me?.email ?? '' }}
                templates={templates}
                club={club}
                canLog={writable}
              />
            </div>
          </section>

          {writable && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold">Log activity</h2>
              <div className="mt-3">
                <ActivityComposer companyId={id} contacts={contacts ?? []} />
              </div>
            </section>
          )}

          <section className="card overflow-hidden">
            <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">Timeline</h2>
            {activities && activities.length > 0 ? (
              <ul className="divide-y divide-black/5">
                {activities.map((a) => {
                  const author = a.profiles as { full_name: string | null; email: string } | null;
                  return (
                    <li key={a.id} className="px-5 py-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium">
                          <span className="chip mr-2 bg-black/[0.05] text-black/55">{a.type}</span>
                          {a.subject}
                        </span>
                        <span className="shrink-0 text-xs text-black/40">
                          {new Date(a.occurred_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                      {a.body && (
                        <p className="mt-1.5 whitespace-pre-wrap text-sm text-black/70">{a.body}</p>
                      )}
                      <p className="mt-1.5 text-xs text-black/35">
                        Logged by {displayName(author)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-black/45">
                Nothing logged yet. Record your first outreach above.
              </p>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
              <h2 className="text-sm font-semibold">Contacts</h2>
              <span className={`chip ${STATUS_STYLES[c.status as Status]}`}>
                {STATUS_LABELS[c.status as Status]}
              </span>
            </div>

            {/* Grouped by division, then indented by who reports to whom —
                six names in a flat list say nothing about who to ask when the
                first one goes quiet. */}
            <ContactTree
              contacts={(contacts ?? []) as never}
              companyId={id}
              writable={writable}
            />

            {writable && (
              <div className="border-t border-black/10 p-4">
                <ContactForm companyId={id} compact />
                <AttachContact companyId={id} contacts={(unlinked ?? []) as UnlinkedContact[]} />
              </div>
            )}
          </section>

          <section className="card overflow-hidden">
            <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">Tasks</h2>
            {tasks && tasks.length > 0 ? (
              <ul className="divide-y divide-black/5">
                {tasks.map((t) => (
                  <TaskRow key={t.id} task={t as never} today={today} showDelete readOnly={!writable} />
                ))}
              </ul>
            ) : (
              !writable && <p className="px-5 py-4 text-xs text-black/45">No tasks.</p>
            )}
            {writable && (
              <div className="border-t border-black/10 p-4">
                <QuickTaskForm companyId={id} />
              </div>
            )}
          </section>

          <section className="card overflow-hidden">
            <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">Files</h2>
            <div className="px-5 py-3">
              <Attachments
                companyId={id}
                files={(files ?? []) as unknown as AttachmentRow[]}
                writable={writable}
              />
            </div>
          </section>

          {/* Was "Status history", which only ever showed status. Everything
              that happens to this company now lands here. */}
          <section className="card overflow-hidden">
            <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">History</h2>
            <ActivityFeed
              events={history}
              showCompany={false}
              omitName={c.name}
              empty="No changes recorded yet."
            />
          </section>
        </div>
      </div>
    </div>
  );
}
