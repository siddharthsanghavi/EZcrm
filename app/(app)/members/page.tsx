import { currentProfile, serverClient } from '@/lib/supabase';
import { removeMember, setMemberRole, updateMyName } from '@/app/actions';
import { AddMemberForm } from '@/components/add-member-form';
import { displayName } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const me = await currentProfile();
  const supabase = await serverClient();

  const [{ data: profiles }, { data: allowed }] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, role').order('email'),
    supabase.from('allowed_emails').select('email, note, added_at').order('added_at'),
  ]);

  const isAdmin = me?.role === 'admin';
  const adminCount = (profiles ?? []).filter((p) => p.role === 'admin').length;
  const profileByEmail = new Map((profiles ?? []).map((p) => [p.email.toLowerCase(), p]));

  // Allowlisted but never signed in — worth showing, because "I added them and
  // nothing happened" is otherwise invisible.
  const pending = (allowed ?? []).filter((a) => !profileByEmail.has(a.email.toLowerCase()));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="mt-1 text-sm text-black/55">
          Anyone on this list can sign in. Everyone sees the same companies — access is all or
          nothing.
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
                  p.role === 'admin' ? 'bg-violet-100 text-violet-800' : 'bg-black/[0.05] text-black/55'
                }`}
              >
                {p.role}
              </span>

              {isAdmin && (
                <>
                  {/* The last admin can't be demoted — that would leave nobody
                      able to manage members. */}
                  {!(p.role === 'admin' && adminCount <= 1) && (
                    <form action={setMemberRole}>
                      <input type="hidden" name="id" value={p.id} />
                      <input
                        type="hidden"
                        name="role"
                        value={p.role === 'admin' ? 'member' : 'admin'}
                      />
                      <button className="text-xs text-black/45 hover:text-ink">
                        {p.role === 'admin' ? 'Make member' : 'Make admin'}
                      </button>
                    </form>
                  )}

                  {p.id !== me?.id && (
                    <form action={removeMember}>
                      <input type="hidden" name="email" value={p.email} />
                      <button className="text-xs text-black/30 hover:text-rose-700">Remove</button>
                    </form>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

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
                {isAdmin && (
                  <form action={removeMember}>
                    <input type="hidden" name="email" value={a.email} />
                    <button className="text-xs text-black/30 hover:text-rose-700">Remove</button>
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
