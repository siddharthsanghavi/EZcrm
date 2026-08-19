import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverClient } from '@/lib/supabase';
import { deleteCompany, setCompanyStatus } from '@/app/actions';
import {
  STATUS_LABELS,
  STATUS_STYLES,
  STATUSES,
  TIER_STYLES,
  type Company,
  type Status,
} from '@/lib/types';
import { CompanyForm } from '@/components/company-form';
import { ActivityComposer } from '@/components/activity-composer';
import { ContactForm } from '@/components/contact-form';
import { QuickTaskForm } from '@/components/quick-task-form';
import { TaskRow } from '@/components/task-row';

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

  const [{ data: contacts }, { data: activities }, { data: tasks }] = await Promise.all([
    supabase.from('contacts').select('*').eq('company_id', id).order('created_at'),
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
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const c = company as Company;

  if (edit) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href={`/companies/${id}`} className="text-sm text-black/50 hover:text-ink">
          ← {c.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit company</h1>
        <CompanyForm company={c} />

        <form action={deleteCompany} className="card border-rose-200 p-5">
          <input type="hidden" name="id" value={id} />
          <h2 className="text-sm font-semibold text-rose-900">Delete this company</h2>
          <p className="mt-1 text-sm text-black/55">
            Removes its contacts, activity, and tasks too. This can&apos;t be undone.
          </p>
          <button className="btn mt-3 border border-rose-300 text-rose-800 hover:bg-rose-50">
            Delete {c.name}
          </button>
        </form>
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
              {[c.type, [c.city, c.region].filter(Boolean).join(' · ')].filter(Boolean).join(' — ')}
              {c.employees ? ` · ~${c.employees.toLocaleString()} employees` : ''}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <form action={setCompanyStatus} className="flex items-center gap-2">
              <input type="hidden" name="id" value={id} />
              <select
                name="status"
                defaultValue={c.status}
                className="field w-44 py-1.5"
                aria-label="Status"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <button className="btn-ghost py-1.5">Update</button>
            </form>
            <Link href={`/companies/${id}?edit=1`} className="btn-ghost py-1.5">
              Edit
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {(c.notes || c.address) && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold">Notes</h2>
              {c.notes && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-black/70">{c.notes}</p>
              )}
              {c.address && (
                <p className="mt-3 text-sm text-black/50">
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(c.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-ink"
                  >
                    {c.address}
                  </a>
                </p>
              )}
            </section>
          )}

          <section className="card p-5">
            <h2 className="text-sm font-semibold">Log activity</h2>
            <div className="mt-3">
              <ActivityComposer companyId={id} contacts={contacts ?? []} />
            </div>
          </section>

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
                      {author && (
                        <p className="mt-1.5 text-xs text-black/35">
                          {author.full_name ?? author.email}
                        </p>
                      )}
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

            {contacts && contacts.length > 0 && (
              <ul className="divide-y divide-black/5">
                {contacts.map((p) => (
                  <li key={p.id} className="px-5 py-3 text-sm">
                    <div className="font-medium">
                      {p.first_name} {p.last_name}
                    </div>
                    {p.title && <div className="text-xs text-black/50">{p.title}</div>}
                    {p.email && (
                      <a href={`mailto:${p.email}`} className="text-xs text-black/60 underline">
                        {p.email}
                      </a>
                    )}
                    {p.phone && <div className="text-xs text-black/50">{p.phone}</div>}
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-black/10 p-4">
              <ContactForm companyId={id} compact />
            </div>
          </section>

          <section className="card overflow-hidden">
            <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">Tasks</h2>
            {tasks && tasks.length > 0 && (
              <ul className="divide-y divide-black/5">
                {tasks.map((t) => (
                  <TaskRow key={t.id} task={t as never} today={today} showDelete />
                ))}
              </ul>
            )}
            <div className="border-t border-black/10 p-4">
              <QuickTaskForm companyId={id} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
