import { currentProfile, serverClient } from '@/lib/supabase';
import { removeMember, setMemberRole, updateMyName } from '@/app/actions';
import { signInQuota } from '@/app/auth-quota';
import { AddMemberForm } from '@/components/add-member-form';
import { EmailQuotaTracker, type QuotaRequest } from '@/components/email-quota-tracker';
import { LoginTracker, type LoginRow } from '@/components/login-tracker';
import { ROLE_HINTS, displayName, type Role } from '@/lib/types';

/**
 * Member administration, lifted out of the old /members page so it can live
 * as a section of /settings. Still a server component doing its own queries:
 * the settings page renders whichever section is asked for, and none of the
 * others pay for it.
 */
export async function MembersPanel() {
  const me = await currentProfile();
  const supabase = await serverClient();

  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();

  // The two logs are admin-read-only at the RLS level, so for a member they
  // simply come back empty rather than erroring — no need to branch here.
  const [
    { data: profiles },
    { data: allowed },
    { data: emailRequests },
    { data: logins },
    { count: linksThisWeek },
    quota,
  ] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, role').order('email'),
    supabase.from('allowed_emails').select('email, note, role, added_at').order('added_at'),
    supabase
      .from('auth_email_requests')
      .select('email, outcome, requested_at')
      .gt('requested_at', dayAgo)
      .order('requested_at', { ascending: false }),
    supabase
      .from('login_events')
      .select('email, event, method, reason, created_at, profiles(full_name, email)')
      .gt('created_at', weekAgo)
      .order('created_at', { ascending: false }),
    // Links actually sent over the same week, for the shortfall figure.
    supabase
      .from('auth_email_requests')
      .select('id', { count: 'exact', head: true })
      .eq('outcome', 'sent')
      .gt('requested_at', weekAgo),
    signInQuota(),
  ]);

  const isAdmin = me?.role === 'admin';
  const adminCount = (profiles ?? []).filter((p) => p.role === 'admin').length;
  const profileByEmail = new Map((profiles ?? []).map((p) => [p.email.toLowerCase(), p]));

  // Allowlisted but never signed in — worth showing, because "I added them and
  // nothing happened" is otherwise invisible.
  const pending = (allowed ?? []).filter((a) => !profileByEmail.has(a.email.toLowerCase()));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-black/55">
          Anyone on this list can sign in and sees the same companies. What differs is what they
          may change: a <strong>viewer</strong> reads only, a <strong>member</strong> reads and
          writes, an <strong>admin</strong> also manages people and deletes companies.
        </p>
      </div>

      <section className="card p-5">
        <h2 className="text-sm font-semibold">Your display name</h2>
        <p className="mt-1 text-sm text-black/55">
          Shown on companies you own and on everything you log. Without it you appear as{' '}
          <code>{me?.email.split('@')[0]}</code>.
        </p>
        <form action={updateMyName} className="mt-3 flex gap-2">
          <input
            name="full_name"
            defaultValue={me?.full_name ?? ''}
            placeholder="Your name"
            className="field max-w-xs"
          />
          <button className="btn-ghost">Save</button>
        </form>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">
          Signed-in members · {profiles?.length ?? 0}
        </h2>
        <ul className="divide-y divide-black/5">
          {(profiles ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {displayName(p)}
                  {p.id === me?.id && <span className="ml-2 text-xs text-black/40">you</span>}
                </div>
                <div className="text-xs text-black/50">{p.email}</div>
              </div>

              <span
                className={`chip ${
                  p.role === 'admin'
                    ? 'bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-300'
                    : p.role === 'viewer'
                      ? 'bg-black/[0.04] text-black/45'
                      : 'bg-black/[0.05] text-black/55'
                }`}
                title={ROLE_HINTS[p.role as Role]}
              >
                {p.role}
              </span>

              {isAdmin && (
                <>
                  {/* A select rather than a toggle now that there are three
                      roles. The last admin can't be demoted — that would leave
                      nobody able to manage members — so they get no control at
                      all rather than one that errors. */}
                  {!(p.role === 'admin' && adminCount <= 1) && (
                    <form action={setMemberRole} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={p.id} />
                      <select
                        name="role"
                        defaultValue={p.role}
                        aria-label={`Role for ${p.email}`}
                        className="field w-28 py-1 text-xs"
                      >
                        <option value="viewer">viewer</option>
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                      </select>
                      <button className="text-xs text-black/45 hover:text-ink">Set</button>
                    </form>
                  )}

                  {p.id !== me?.id && (
                    <form action={removeMember}>
                      <input type="hidden" name="email" value={p.email} />
                      <button className="text-xs text-black/30 hover:text-danger">Remove</button>
                    </form>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <>
          <LoginTracker
            rows={(logins ?? []) as unknown as LoginRow[]}
            linksRequested={linksThisWeek ?? 0}
          />
          <EmailQuotaTracker
            requests={(emailRequests ?? []) as QuotaRequest[]}
            quota={quota?.quota ?? 2}
          />
        </>
      )}

      {pending.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">
            Invited, not signed in yet · {pending.length}
          </h2>
          <ul className="divide-y divide-black/5">
            {pending.map((a) => (
              <li key={a.email} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div>{a.email}</div>
                  {a.note && <div className="text-xs text-black/45">{a.note}</div>}
                </div>
                {/* What they will become on first sign-in, so an invitation
                    sent as view-only can be checked before they arrive. */}
                <span className="chip bg-black/[0.04] text-black/45">{a.role ?? 'member'}</span>
                {isAdmin && (
                  <form action={removeMember}>
                    <input type="hidden" name="email" value={a.email} />
                    <button className="text-xs text-black/30 hover:text-danger">Remove</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-black/10 px-5 py-3 text-xs text-black/45">
            They just need to open the app and request a sign-in link.
          </p>
        </section>
      )}

      {isAdmin ? (
        <section className="card p-5">
          <h2 className="text-sm font-semibold">Add a member</h2>
          <p className="mt-1 text-sm text-black/55">
            Adding an address lets that person sign in. Nobody else can get in, even if they know
            the URL.
          </p>
          <AddMemberForm />
        </section>
      ) : (
        <p className="text-sm text-black/45">Only admins can add or remove members.</p>
      )}
    </div>
  );
}
