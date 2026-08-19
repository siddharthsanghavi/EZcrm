import { CsvImport } from '@/components/csv-import';

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import / Export</h1>
        <p className="mt-1 text-sm text-black/55">
          Bring in a list you already have, or pull everything back out. Your data is never locked in.
        </p>
      </div>

      <CsvImport />

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
    </div>
  );
}
