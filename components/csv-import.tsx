'use client';

import { useState } from 'react';
import Papa from 'papaparse';

type Row = Record<string, string>;
type Duplicate = { name: string; reason: string; existing: string };
type Result = {
  created: number;
  skipped: number;
  errors: string[];
  duplicates?: Duplicate[];
} | null;
type DryRun = {
  wouldCreate: number;
  skipped: number;
  duplicates: Duplicate[];
  errors: string[];
} | null;

const COMPANY_COLUMNS =
  'name, type, tier, city, region, address, phone, website, industry, employees, capabilities, status, interest, notes';
const CONTACT_COLUMNS = 'first_name, last_name, email, phone, title, company, notes';

export function CsvImport() {
  const [table, setTable] = useState<'companies' | 'contacts'>('companies');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [review, setReview] = useState<DryRun>(null);
  // Names the importer has looked at and decided to add anyway.
  const [keepAnyway, setKeepAnyway] = useState<string[]>([]);
  const [parseError, setParseError] = useState('');

  function handleFile(file: File) {
    setResult(null);
    setParseError('');

    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      // Normalize headers so "First Name" and "first_name" both land correctly.
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: ({ data, errors }) => {
        if (errors.length > 0) setParseError(errors[0].message);
        setRows(data);
      },
    });
  }

  /**
   * Look before importing.
   *
   * A dry run reports what would happen without writing anything, so probable
   * duplicates get a decision rather than a silent skip. Contacts go straight
   * through: they have no equivalent notion of a near match, and a person with
   * the same name at a different company is a different person.
   */
  async function check() {
    setBusy(true);
    setResult(null);
    setReview(null);
    setKeepAnyway([]);

    if (table === 'contacts') {
      await upload([]);
      return;
    }

    const response = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, rows, dryRun: true }),
    });

    const json = await response.json();
    setBusy(false);

    if (!response.ok) {
      setResult({ created: 0, skipped: 0, errors: [json.error] });
      return;
    }

    if ((json.duplicates ?? []).length === 0) {
      await upload([]);
      return;
    }

    setReview(json as DryRun);
  }

  async function upload(force: string[]) {
    setBusy(true);
    setResult(null);

    const response = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, rows, force }),
    });

    const json = await response.json();
    setResult(response.ok ? json : { created: 0, skipped: 0, errors: [json.error] });
    setBusy(false);
    setReview(null);
    if (response.ok) {
      setRows([]);
      setKeepAnyway([]);
    }
  }

  const preview = rows.slice(0, 5);
  const headers = preview.length > 0 ? Object.keys(preview[0]) : [];

  return (
    <section className="card p-6">
      <h2 className="text-sm font-semibold">Import CSV</h2>

      <div className="mt-4 flex gap-2">
        {(['companies', 'contacts'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTable(t);
              setRows([]);
              setResult(null);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
              table === t ? 'bg-ink text-white' : 'bg-black/[0.05] text-black/60 hover:bg-black/10'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-black/50">
        Recognised columns: <code>{table === 'companies' ? COMPANY_COLUMNS : CONTACT_COLUMNS}</code>.
        Extra columns are ignored.
        {table === 'companies'
          ? ' Companies whose name is already in the CRM are skipped, so re-importing tops up rather than duplicates. Address, city and region become the company’s primary location; add any further sites from its own page.'
          : ' A "company" column matches on name and links the contact.'}
      </p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        className="mt-4 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-ink
                   file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
      />

      {parseError && <p className="mt-3 text-sm text-danger">{parseError}</p>}

      {preview.length > 0 && (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-black/60">
            {rows.length} row{rows.length === 1 ? '' : 's'} ready — first {preview.length} shown.
          </p>

          <div className="overflow-x-auto rounded-md border border-black/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-black/[0.03]">
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {preview.map((row, i) => (
                  <tr key={i}>
                    {headers.map((h) => (
                      <td key={h} className="max-w-[14rem] truncate px-3 py-2 text-black/65">
                        {row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={check} className="btn-primary" disabled={busy}>
            {busy ? 'Importing…' : `Import ${rows.length} ${table}`}
          </button>
        </div>
      )}

      {review && (
        <div className="mt-4 space-y-3 rounded-lg border border-warn/40 bg-warn/[0.06] p-4">
          <div>
            <h3 className="text-sm font-semibold">
              {review.duplicates.length} row{review.duplicates.length === 1 ? '' : 's'} look
              {review.duplicates.length === 1 ? 's' : ''} like something already here
            </h3>
            <p className="mt-1 text-xs text-black/55">
              {review.wouldCreate} would be added. Tick anything that is genuinely a different
              company — two sites of one firm, say — and it will be imported too.
            </p>
          </div>

          <ul className="max-h-56 space-y-1 overflow-auto text-xs">
            {review.duplicates.map((d) => (
              <li key={d.name} className="flex items-baseline gap-2">
                <input
                  type="checkbox"
                  id={`keep-${d.name}`}
                  checked={keepAnyway.includes(d.name)}
                  onChange={(e) =>
                    setKeepAnyway((list) =>
                      e.target.checked ? [...list, d.name] : list.filter((n) => n !== d.name),
                    )
                  }
                  className="mt-0.5 h-3.5 w-3.5 rounded border-black/25"
                />
                <label htmlFor={`keep-${d.name}`} className="min-w-0">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-black/50"> — {d.reason} as </span>
                  <span className="font-medium">{d.existing}</span>
                </label>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => upload(keepAnyway)} className="btn-primary" disabled={busy}>
              {keepAnyway.length > 0
                ? `Import ${review.wouldCreate + keepAnyway.length}`
                : `Import ${review.wouldCreate}, skip the rest`}
            </button>
            <button type="button" onClick={() => setReview(null)} className="btn-ghost">
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-md bg-black/[0.03] p-3 text-sm">
          <p className="font-medium">
            Imported {result.created}
            {result.skipped > 0 && ` · skipped ${result.skipped} already here`}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-danger">
              {result.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
