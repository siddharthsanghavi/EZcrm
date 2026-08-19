'use client';

import { useState } from 'react';
import Papa from 'papaparse';

type Row = Record<string, string>;
type Result = { created: number; skipped: number; errors: string[] } | null;

const COMPANY_COLUMNS =
  'name, type, tier, city, region, address, phone, website, industry, employees, status, interest, notes';
const CONTACT_COLUMNS = 'first_name, last_name, email, phone, title, company, notes';

export function CsvImport() {
  const [table, setTable] = useState<'companies' | 'contacts'>('companies');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
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

  async function upload() {
    setBusy(true);
    setResult(null);

    const response = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, rows }),
    });

    const json = await response.json();
    setResult(response.ok ? json : { created: 0, skipped: 0, errors: [json.error] });
    setBusy(false);
    if (response.ok) setRows([]);
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
          ? ' Companies whose name is already in the CRM are skipped, so re-importing tops up rather than duplicates.'
          : ' A "company" column matches on name and links the contact.'}
      </p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        className="mt-4 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-ink
                   file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
      />

      {parseError && <p className="mt-3 text-sm text-rose-700">{parseError}</p>}

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

          <button onClick={upload} className="btn-primary" disabled={busy}>
            {busy ? 'Importing…' : `Import ${rows.length} ${table}`}
          </button>
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-md bg-black/[0.03] p-3 text-sm">
          <p className="font-medium">
            Imported {result.created}
            {result.skipped > 0 && ` · skipped ${result.skipped}`}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-rose-700">
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
