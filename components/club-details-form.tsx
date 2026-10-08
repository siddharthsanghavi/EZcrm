'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { saveClubDetails } from '@/app/actions';
import type { ClubDetails } from '@/lib/cold-email';
import { isValidTimeZone } from '@/lib/types';

type State = { error?: string; ok?: boolean } | null;

/**
 * Zones to offer. The runtime's full list where it has one (every current
 * browser), else a short list that covers the clubs this is likely to serve.
 * Whatever is already saved is always present, so a zone this browser has
 * never heard of does not vanish from its own dropdown.
 */
function zoneOptions(current: string): string[] {
  const fallback = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'America/Toronto',
    'America/Vancouver',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const all = intl.supportedValuesOf?.('timeZone') ?? fallback;
  return [...new Set([current, ...all])].sort();
}

/**
 * Client form so "only admins can change club settings" arrives as a sentence
 * rather than as a save that silently does nothing. RLS refuses a member's
 * write by matching no rows, which looks exactly like success.
 */
export function ClubDetailsForm({ club, isAdmin }: { club: ClubDetails; isAdmin: boolean }) {
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await saveClubDetails(formData)) ?? null,
    null,
  );

  const [timeZone, setTimeZone] = useState(club.timeZone);
  const zones = useMemo(() => zoneOptions(club.timeZone), [club.timeZone]);

  // What this browser thinks the zone is. Read after mount — a Server
  // Component has no idea, and the first render has to match the server's.
  const [detected, setDetected] = useState<string | null>(null);
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(tz)) setDetected(tz);
  }, []);

  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
      <Field name="clubName" label="Club name" value={club.clubName} placeholder="Engineering Society" disabled={!isAdmin} />
      <Field name="school" label="School or university" value={club.school} placeholder="Riverbend University" disabled={!isAdmin} />
      <Field name="groupSize" label="Group size" value={club.groupSize} placeholder="20" disabled={!isAdmin} />
      <Field name="visitLength" label="Visit length" value={club.visitLength} placeholder="two hours" disabled={!isAdmin} />

      <label className="block text-xs text-black/45 sm:col-span-2">
        Time zone
        <select
          name="timeZone"
          value={timeZone}
          onChange={(e) => setTimeZone(e.target.value)}
          disabled={!isAdmin}
          className="field mt-1 disabled:opacity-60"
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-black/40">
          Decides when “today” ends for due tasks and the daily outreach goal. On UTC, a task due
          today in Georgia goes overdue at 8pm.
          {isAdmin && detected && detected !== timeZone && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => setTimeZone(detected)}
                className="underline hover:text-ink"
              >
                Use {detected.replace(/_/g, ' ')}
              </button>
              , which is where this browser is.
            </>
          )}
        </span>
      </label>

      <div className="sm:col-span-2">
        {isAdmin ? (
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </button>
            {state?.ok && <span className="text-sm text-success">Saved.</span>}
            {state?.error && <span className="text-sm text-danger">{state.error}</span>}
          </div>
        ) : (
          <p className="text-xs text-black/45">
            Only admins can change these — they appear in mail the whole club sends.
          </p>
        )}
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  value,
  placeholder,
  disabled,
}: {
  name: string;
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
}) {
  // A placeholder value shows as an empty field with the example in grey:
  // typing over "[YOUR CLUB]" is worse than typing into a blank.
  const placeholderish = value.startsWith('[');

  return (
    <label className="block text-xs text-black/45">
      {label}
      <input
        name={name}
        defaultValue={placeholderish ? '' : value}
        placeholder={placeholderish ? placeholder : ''}
        disabled={disabled}
        className="field mt-1 disabled:opacity-60"
      />
    </label>
  );
}
