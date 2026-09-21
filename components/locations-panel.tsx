'use client';

import { useState } from 'react';
import { addLocation, deleteLocation, setPrimaryLocation, updateLocation } from '@/app/actions';
import { locationLabel, type CompanyLocation } from '@/lib/types';

type Row = Pick<
  CompanyLocation,
  'id' | 'label' | 'address' | 'city' | 'region' | 'county' | 'latitude' | 'geo_precision' | 'is_primary'
>;

/**
 * Every place a company is.
 *
 * A manufacturer with three plants is one company and three locations: you
 * call the head office, you tour the plant, and the map shows both. Exactly
 * one is primary — it stands in wherever the app has room for a single place
 * (the list row, the search hit, the company header), and the database keeps
 * that invariant rather than this component.
 */
export function LocationsPanel({
  companyId,
  locations,
  writable,
}: {
  companyId: string;
  locations: Row[];
  writable: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: (fd: FormData) => Promise<{ error?: string } | void>, fd: FormData) => {
    setError(null);
    const result = await action(fd);
    if (result && 'error' in result && result.error) {
      setError(result.error);
      return false;
    }
    return true;
  };

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Locations
          {locations.length > 1 && (
            <span className="ml-2 rounded-md bg-black/[0.06] px-1.5 py-px text-[11.5px] font-medium text-black/55">
              {locations.length}
            </span>
          )}
        </h2>
        {writable && !adding && (
          <button onClick={() => setAdding(true)} className="btn-ghost text-xs">
            Add location
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {locations.length === 0 && !adding && (
        <p className="mt-2 text-sm text-black/45">
          No location recorded. The map can only show companies that have one.
        </p>
      )}

      <ul className="mt-3 divide-y divide-black/[0.06]">
        {locations.map((l) =>
          editing === l.id ? (
            <li key={l.id} className="py-3">
              <LocationFields
                location={l}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={async (fd) => {
                  fd.set('id', l.id);
                  fd.set('company_id', companyId);
                  if (await run(updateLocation, fd)) setEditing(null);
                }}
              />
            </li>
          ) : (
            <li key={l.id} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{locationLabel(l)}</span>
                  {l.is_primary && (
                    <span className="chip bg-accent/[0.12] text-accent">Primary</span>
                  )}
                  {/* Hollow pins on the map mean the same thing this does. */}
                  {l.latitude === null && (
                    <span className="chip bg-black/[0.05] text-black/50">Not on the map</span>
                  )}
                  {l.latitude !== null && l.geo_precision !== 'address' && (
                    <span className="chip bg-black/[0.05] text-black/50">Approximate</span>
                  )}
                </div>
                {l.county && <div className="mt-0.5 text-xs text-black/45">{l.county} County</div>}
              </div>

              <div className="flex shrink-0 items-center gap-3 text-xs">
                {l.address && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(
                      [l.address, l.city, l.region].filter(Boolean).join(', '),
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-black/45 underline hover:text-ink"
                  >
                    Map
                  </a>
                )}
                {writable && (
                  <>
                    {!l.is_primary && (
                      <button
                        className="text-black/45 hover:text-ink"
                        onClick={() => {
                          const fd = new FormData();
                          fd.set('id', l.id);
                          fd.set('company_id', companyId);
                          void run(setPrimaryLocation, fd);
                        }}
                      >
                        Make primary
                      </button>
                    )}
                    <button className="text-black/45 hover:text-ink" onClick={() => setEditing(l.id)}>
                      Edit
                    </button>
                    <button
                      className="text-black/45 hover:text-danger"
                      onClick={() => {
                        if (!confirm(`Remove ${locationLabel(l)}?`)) return;
                        const fd = new FormData();
                        fd.set('id', l.id);
                        fd.set('company_id', companyId);
                        void run(deleteLocation, fd);
                      }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </li>
          ),
        )}
      </ul>

      {adding && (
        <div className="mt-3 border-t border-black/[0.06] pt-3">
          <LocationFields
            submitLabel="Add"
            onCancel={() => setAdding(false)}
            onSubmit={async (fd) => {
              fd.set('company_id', companyId);
              if (await run(addLocation, fd)) setAdding(false);
            }}
          />
        </div>
      )}
    </section>
  );
}

function LocationFields({
  location,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  location?: Row;
  submitLabel: string;
  onSubmit: (fd: FormData) => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <form
      action={onSubmit}
      className="space-y-3"
      // A location form nested in the company page must not inherit its submit.
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`label-${location?.id ?? 'new'}`}>
            Name
          </label>
          <input
            id={`label-${location?.id ?? 'new'}`}
            name="label"
            defaultValue={location?.label ?? ''}
            placeholder="Head office, Plant 2…"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor={`address-${location?.id ?? 'new'}`}>
            Address
          </label>
          <input
            id={`address-${location?.id ?? 'new'}`}
            name="address"
            defaultValue={location?.address ?? ''}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor={`city-${location?.id ?? 'new'}`}>
            City
          </label>
          <input
            id={`city-${location?.id ?? 'new'}`}
            name="city"
            defaultValue={location?.city ?? ''}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor={`region-${location?.id ?? 'new'}`}>
            Region
          </label>
          <input
            id={`region-${location?.id ?? 'new'}`}
            name="region"
            defaultValue={location?.region ?? ''}
            className="field"
          />
        </div>
      </div>

      {!location?.is_primary && (
        <label className="flex items-center gap-2 text-sm text-black/60">
          <input type="checkbox" name="is_primary" defaultChecked={false} />
          Make this the primary location
        </label>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary text-xs">
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost text-xs">
          Cancel
        </button>
      </div>
    </form>
  );
}
