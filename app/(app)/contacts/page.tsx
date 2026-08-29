import Link from 'next/link';
import { currentProfile, serverClient } from '@/lib/supabase';
import { canWrite } from '@/lib/types';
import { deleteContact } from '@/app/actions';
import { ContactForm } from '@/components/contact-form';

export const dynamic = 'force-dynamic';

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await serverClient();
  const writable = canWrite(await currentProfile());

  let query = supabase
    .from('contacts')
    .select('*, companies(id, name)')
    .order('created_at', { ascending: false });

  if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`);

  const [{ data: contacts }, { data: companies }] = await Promise.all([
    query,
    supabase.from('companies').select('id, name').order('name'),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <form className="flex gap-2">
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Search name or email…"
              className="field w-64"
            />
            <button className="btn-ghost">Search</button>
          </form>

          <div className="card overflow-hidden">
            {contacts && contacts.length > 0 ? (
              <ul className="divide-y divide-black/5">
                {contacts.map((c) => {
                  const company = c.companies as { id: string; name: string } | null;
                  return (
                    <li key={c.id} className="flex items-start gap-4 px-5 py-3.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {c.first_name} {c.last_name}
                          {c.title && <span className="font-normal text-black/50"> · {c.title}</span>}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-black/55">
                          {company && (
                            <Link href={`/companies/${company.id}`} className="underline">
                              {company.name}
                            </Link>
                          )}
                          {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                          {c.phone && <span>{c.phone}</span>}
                        </div>
                      </div>

                      {writable && (
                        <form action={deleteContact}>
                          <input type="hidden" name="id" value={c.id} />
                          <button className="text-xs text-black/30 hover:text-danger">Delete</button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-10 text-center text-sm text-black/45">No contacts found.</p>
            )}
          </div>
        </div>

        {writable && (
          <section className="card h-fit p-5">
            <h2 className="mb-3 text-sm font-semibold">Add contact</h2>
            <ContactForm companies={companies ?? []} />
          </section>
        )}
      </div>
    </div>
  );
}
