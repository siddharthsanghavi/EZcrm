import { CsvImport } from '@/components/csv-import';
import { GeocodePanel } from '@/components/geocode-panel';
import { geocodePending } from '@/app/geocode-actions';
import { currentProfile } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const [profile, pending] = await Promise.all([currentProfile(), geocodePending()]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import / Export</h1>
        <p className="mt-1 text-sm text-black/55">
          Bring in a list you already have, or pull everything back out. Your data is never locked in.
        </p>
      </div>

      {/* Importing writes hundreds of rows at once — the last thing a viewer
          should be offered. Export stays, because reading is the point. */}
      {profile?.role !== 'viewer' && <CsvImport />}

      <section className="card p-6">
        <h2 className="text-sm font-semibold">Export</h2>
        <p className="mt-1 text-sm text-black/55">
          Downloads a CSV of everything currently in the CRM.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/api/export?table=companies" className="btn-ghost">
            Companies CSV
          </a>
          <a href="/api/export?table=contacts" className="btn-ghost">
            Contacts CSV
          </a>
          <a href="/api/export?table=activities" className="btn-ghost">
            Activity CSV
          </a>
        </div>
      </section>

      {/* Admin-only: it rewrites coordinates on shared records. The Edge
          Function re-checks this; the guard here just avoids showing a button
          that would refuse. */}
      {profile?.role === 'admin' && <GeocodePanel pending={pending} />}
    </div>
  );
}
