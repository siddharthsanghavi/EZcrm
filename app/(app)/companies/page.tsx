import Link from 'next/link';
import { serverClient } from '@/lib/supabase';
import {
  STATUS_LABELS,
  STATUS_STYLES,
  STATUSES,
  TIER_STYLES,
  TIERS,
  displayName,
  type Status,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type Search = {
  status?: string;
  tier?: string;
  type?: string;
  region?: string;
  owner?: string;
  q?: string;
  page?: string;
};

/** Rebuild the querystring with one filter changed, always resetting to page 1. */
function withFilter(current: Search, key: keyof Search, value?: string) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v && k !== 'page' && k !== key) params.set(k, v);
  }
  if (value) params.set(key, value);
  const qs = params.toString();
  return `/companies${qs ? `?${qs}` : ''}`;
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const { status, tier, type, region, owner, q } = sp;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  const supabase = await serverClient();

  let query = supabase
    .from('companies')
    .select(
      'id, name, website, industry, status, interest, type, tier, city, region, owner_id, contacts(count), profiles!companies_owner_id_fkey(full_name, email)',
      { count: 'exact' },
    )
    // Tier 1 first, then Tier 2, and so on — the directory's own ranking is the
    // most useful default order for deciding who to call.
    .order('tier_rank', { ascending: true })
    .order('name', { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (status && STATUSES.includes(status as Status)) query = query.eq('status', status);
  if (tier) query = query.eq('tier', tier);
  if (type) query = query.eq('type', type);
  if (region) query = query.eq('region', region);
  // "none" is a real filter — the unassigned pile is the one people work from.
  if (owner === 'none') query = query.is('owner_id', null);
  else if (owner) query = query.eq('owner_id', owner);
  if (q) query = query.or(`name.ilike.%${q}%,city.ilike.%${q}%,industry.ilike.%${q}%`);

  // Distinct values for the dropdowns. Cheap enough at this size, and it means
  // the filters always reflect whatever is actually in the database.
  const [{ data: companies, count, error }, { data: facets }, { data: members }] = await Promise.all([
    query,
    supabase.from('companies').select('type, region').limit(5000),
    supabase.from('profiles').select('id, full_name, email').order('email'),
  ]);

  const types = [...new Set((facets ?? []).map((f) => f.type).filter(Boolean))].sort();
  const regions = [...new Set((facets ?? []).map((f) => f.region).filter(Boolean))].sort();

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="mt-1 text-sm text-black/55">
            {total.toLocaleString()} match{total === 1 ? '' : 'es'}
          </p>
        </div>
        <Link href="/companies/new" className="btn-primary">
          Add company
        </Link>
      </div>

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <form className="flex gap-2">
            {Object.entries(sp).map(
              ([k, v]) =>
                v &&
                k !== 'q' &&
                k !== 'page' && <input key={k} type="hidden" name={k} value={v} />,
            )}
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Search name, city, specialty…"
              className="field w-64"
            />
            <button className="btn-ghost">Search</button>
          </form>

          <FilterSelect
            label="Type"
            value={type}
            options={types as string[]}
            current={sp}
            param="type"
          />
          <FilterSelect
            label="Region"
            value={region}
            options={regions as string[]}
            current={sp}
            param="region"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-medium text-black/40">Tier</span>
          <Pill href={withFilter(sp, 'tier')} active={!tier}>
            Any
          </Pill>
          {TIERS.map((t) => (
            <Pill key={t} href={withFilter(sp, 'tier', t)} active={tier === t}>
              {t}
            </Pill>
          ))}

          <span className="ml-4 mr-1 text-xs font-medium text-black/40">Owner</span>
          <Pill href={withFilter(sp, 'owner')} active={!owner}>
            Anyone
          </Pill>
          {(members ?? []).map((m) => (
            <Pill key={m.id} href={withFilter(sp, 'owner', m.id)} active={owner === m.id}>
              {displayName(m)}
            </Pill>
          ))}
          <Pill href={withFilter(sp, 'owner', 'none')} active={owner === 'none'}>
            Unassigned
          </Pill>

          <span className="ml-4 mr-1 text-xs font-medium text-black/40">Status</span>
          <Pill href={withFilter(sp, 'status')} active={!status}>
            Any
          </Pill>
          {STATUSES.map((s) => (
            <Pill key={s} href={withFilter(sp, 'status', s)} active={status === s}>
              {STATUS_LABELS[s]}
            </Pill>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-rose-700">{error.message}</p>}

      <div className="card overflow-hidden">
        {companies && companies.length > 0 ? (
          <ul className="divide-y divide-black/5">
            {companies.map((c) => {
              const contactCount = (c.contacts as unknown as { count: number }[])?.[0]?.count ?? 0;
              return (
                <li key={c.id}>
                  <Link
                    href={`/companies/${c.id}`}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-black/[0.02]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      <div className="mt-0.5 truncate text-xs text-black/50">
                        {[c.type, c.city, c.industry].filter(Boolean).join(' · ')}
                      </div>
                    </div>

                    {c.owner_id && (
                      <span className="hidden shrink-0 text-xs text-black/45 md:block">
                        {displayName(
                          c.profiles as unknown as { full_name: string | null; email: string } | null,
                        )}
                      </span>
                    )}

                    {contactCount > 0 && (
                      <span className="hidden shrink-0 text-xs text-black/40 sm:block">
                        {contactCount} contact{contactCount === 1 ? '' : 's'}
                      </span>
                    )}

                    {c.tier && (
                      <span className={`chip shrink-0 ${TIER_STYLES[c.tier] ?? ''}`}>{c.tier}</span>
                    )}

                    <span className={`chip shrink-0 ${STATUS_STYLES[c.status as Status]}`}>
                      {STATUS_LABELS[c.status as Status]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-5 py-10 text-center text-sm text-black/45">
            No companies match.{' '}
            <Link href="/companies" className="underline">
              Clear filters
            </Link>{' '}
            or{' '}
            <Link href="/import" className="underline">
              import a CSV
            </Link>
            .
          </div>
        )}
      </div>

      {lastPage > 1 && (
        <div className="flex items-center justify-between text-sm">
          <PageLink sp={sp} page={page - 1} disabled={page <= 1}>
            ← Previous
          </PageLink>
          <span className="text-black/45">
            Page {page} of {lastPage}
          </span>
          <PageLink sp={sp} page={page + 1} disabled={page >= lastPage}>
            Next →
          </PageLink>
        </div>
      )}
    </div>
  );
}

function Pill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
        active ? 'bg-ink text-white' : 'bg-black/[0.05] text-black/60 hover:bg-black/10'
      }`}
    >
      {children}
    </Link>
  );
}

/** A plain GET form, so filtering works without any client-side JavaScript. */
function FilterSelect({
  label,
  value,
  options,
  current,
  param,
}: {
  label: string;
  value?: string;
  options: string[];
  current: Search;
  param: keyof Search;
}) {
  if (options.length === 0) return null;

  return (
    <form className="flex">
      {Object.entries(current).map(
        ([k, v]) =>
          v &&
          k !== param &&
          k !== 'page' && <input key={k} type="hidden" name={k} value={v} />,
      )}
      <select
        name={param}
        defaultValue={value ?? ''}
        aria-label={label}
        className="field w-48 rounded-r-none"
      >
        <option value="">All {label.toLowerCase()}s</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button className="btn-ghost rounded-l-none border-l-0">Go</button>
    </form>
  );
}

function PageLink({
  sp,
  page,
  disabled,
  children,
}: {
  sp: Search;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) return <span className="text-black/25">{children}</span>;

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== 'page') params.set(k, v);
  params.set('page', String(page));

  return (
    <Link href={`/companies?${params}`} className="btn-ghost">
      {children}
    </Link>
  );
}
