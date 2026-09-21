'use client';

import { useActionState } from 'react';
import { saveCompany } from '@/app/actions';
import { INTERESTS, STATUS_LABELS, STATUSES, TIERS, type Company } from '@/lib/types';

type State = { error?: string; ok?: boolean } | null;

/**
 * Create or edit one company, including its primary location.
 *
 * The address fields here write the company's PRIMARY location, not a new one:
 * "add a company" should not open a location editor, and a company that turns
 * out to have three plants grows them from its own page afterwards. See
 * components/locations-panel.tsx.
 */
export function CompanyForm({
  company,
  location,
}: {
  company?: Company;
  location?: { address: string | null; city: string | null; region: string | null } | null;
}) {
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await saveCompany(formData)) ?? null,
    null,
  );

  return (
    <form action={action} className="card space-y-4 p-6">
      {company && <input type="hidden" name="id" value={company.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">
            Company name *
          </label>
          <input id="name" name="name" required defaultValue={company?.name} className="field" />
        </div>

        <div>
          <label className="label" htmlFor="website">
            Website
          </label>
          <input
            id="website"
            name="website"
            defaultValue={company?.website ?? ''}
            placeholder="https://"
            className="field"
          />
        </div>

        <div>
          <label className="label" htmlFor="industry">
            Industry
          </label>
          <input
            id="industry"
            name="industry"
            defaultValue={company?.industry ?? ''}
            className="field"
          />
        </div>

        <div>
          <label className="label" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={company?.status ?? 'prospect'}
            className="field"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="label">We want</legend>
          <div className="flex gap-4 pt-1.5">
            {INTERESTS.map((i) => (
              <label key={i} className="flex items-center gap-2 text-sm capitalize">
                <input
                  type="checkbox"
                  name="interest"
                  value={i}
                  defaultChecked={company?.interest?.includes(i)}
                  className="h-4 w-4 rounded border-black/25"
                />
                {i}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="label" htmlFor="type">
            Type
          </label>
          <input
            id="type"
            name="type"
            defaultValue={company?.type ?? ''}
            placeholder="OEM, Integrator…"
            className="field"
          />
        </div>

        <div>
          <label className="label" htmlFor="tier">
            Tier
          </label>
          <select id="tier" name="tier" defaultValue={company?.tier ?? ''} className="field">
            <option value="">Unrated</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="city">
            City
          </label>
          <input id="city" name="city" defaultValue={location?.city ?? ''} className="field" />
        </div>

        <div>
          <label className="label" htmlFor="region">
            Region
          </label>
          <input id="region" name="region" defaultValue={location?.region ?? ''} className="field" />
        </div>

        <div>
          <label className="label" htmlFor="phone">
            Phone
          </label>
          <input id="phone" name="phone" defaultValue={company?.phone ?? ''} className="field" />
        </div>

        <div>
          <label className="label" htmlFor="amount">
            Amount
          </label>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            placeholder="2500"
            defaultValue={company?.amount ?? ''}
            className="field"
          />
        </div>

        <div>
          <label className="label" htmlFor="close_date">
            {/* Required before a company can be marked committed — the database
                refuses it otherwise, so the field says why here rather than
                letting somebody discover it from an error. */}
            Close date
          </label>
          <input
            id="close_date"
            name="close_date"
            type="date"
            defaultValue={company?.close_date ?? ''}
            className="field"
          />
        </div>

        <div>
          <label className="label" htmlFor="employees">
            Employees
          </label>
          <input
            id="employees"
            name="employees"
            type="number"
            min="0"
            defaultValue={company?.employees ?? ''}
            className="field"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="address">
            Address
          </label>
          <input id="address" name="address" defaultValue={location?.address ?? ''} className="field" />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={company?.notes ?? ''}
            placeholder="Who they are, why they'd say yes, any warm connection…"
            className="field"
          />
        </div>
      </div>

      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">Saved.</p>}

      <div className="flex justify-end">
        <button className="btn-primary" disabled={pending}>
          {pending ? 'Saving…' : company ? 'Save changes' : 'Add company'}
        </button>
      </div>
    </form>
  );
}
