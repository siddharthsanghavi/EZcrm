'use client';

import { useEffect, useMemo, useState } from 'react';
import { logDraftedEmail } from '@/app/actions';
import {
  CLUB_DEFAULTS,
  TEMPLATES,
  contactName,
  draftEmail,
  mailtoLink,
  suggestedTemplate,
  type ClubDetails,
  type TemplateId,
} from '@/lib/cold-email';
import type { Company, Contact } from '@/lib/types';

type Person = Pick<Contact, 'id' | 'first_name' | 'last_name' | 'title' | 'email'>;

const STORE_KEY = 'ezcrm.club-details';

/**
 * Club details live in this browser, not the database.
 *
 * They are the same for everyone in the club and change roughly never, so a
 * table and a settings page would be three new files to avoid typing four
 * fields once. The cost is that each member fills them in on their own machine,
 * which the panel says plainly rather than pretending the values are shared.
 */
function useClubDetails(): [ClubDetails, (next: ClubDetails) => void, boolean] {
  const [details, setDetails] = useState<ClubDetails>(CLUB_DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) setDetails({ ...CLUB_DEFAULTS, ...JSON.parse(raw) });
    } catch {
      // Private window, blocked storage, corrupt JSON — the placeholders are a
      // perfectly usable fallback, so there is nothing to recover from.
    }
    setLoaded(true);
  }, []);

  const save = (next: ClubDetails) => {
    setDetails(next);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // Same again: the draft still works, it just won't remember next time.
    }
  };

  return [details, save, loaded];
}

export function ColdEmail({
  company,
  contacts,
  sender,
  canLog,
}: {
  company: Pick<Company, 'id' | 'name' | 'type' | 'city' | 'industry' | 'interest' | 'tier' | 'status'>;
  contacts: Person[];
  sender: { name: string; email: string };
  /** Viewers can draft and copy; logging it as outreach is a write. */
  canLog: boolean;
}) {
  const withEmail = contacts.filter((c) => c.email);
  const [template, setTemplate] = useState<TemplateId>(() => suggestedTemplate(company));
  const [contactId, setContactId] = useState<string>(() => withEmail[0]?.id ?? '');
  const [details, saveDetails, loaded] = useClubDetails();
  const [editingDetails, setEditingDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [logged, setLogged] = useState(false);

  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const draft = useMemo(
    () => draftEmail(template, { company, contact, sender, club: details }),
    [template, company, contact, sender, details],
  );

  const incomplete = Object.values(details).some((v) => v.startsWith('['));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const chosen = TEMPLATES.find((t) => t.id === template)!;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={template}
          onChange={(e) => setTemplate(e.target.value as TemplateId)}
          aria-label="Template"
          className="field w-52 py-1.5"
        >
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {contacts.length > 0 && (
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            aria-label="Send to"
            className="field w-56 py-1.5"
          >
            <option value="">No named contact</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.email}>
                {contactName(c)}
                {c.title ? ` — ${c.title}` : ''}
                {c.email ? '' : ' (no email)'}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={() => setEditingDetails((v) => !v)}
          className="text-xs text-black/45 hover:text-ink"
        >
          {editingDetails ? 'Done' : 'Club details'}
        </button>
      </div>

      <p className="text-xs text-black/45">{chosen.when}</p>

      {loaded && incomplete && !editingDetails && (
        <p className="text-xs text-warn">
          Fill in your club details or the draft goes out with [PLACEHOLDERS] in it.
        </p>
      )}

      {editingDetails && (
        <div className="card space-y-2 p-3">
          <p className="text-xs text-black/45">
            Saved in this browser only, so each member sets them once on their own machine.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Club name" value={details.clubName}
              onChange={(v) => saveDetails({ ...details, clubName: v })} />
            <Field label="School" value={details.school}
              onChange={(v) => saveDetails({ ...details, school: v })} />
            <Field label="Group size" value={details.groupSize}
              onChange={(v) => saveDetails({ ...details, groupSize: v })} />
            <Field label="Visit length" value={details.visitLength}
              onChange={(v) => saveDetails({ ...details, visitLength: v })} />
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-black/10 px-4 py-2 text-sm">
          <span className="text-black/45">Subject: </span>
          {draft.subject}
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed text-black/75">
{draft.body}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={mailtoLink(contact?.email, draft)}
          className="btn-ghost py-1.5"
          // The draft opens in their own mail client; this app never sends.
        >
          Open in mail app
        </a>

        <button type="button" onClick={copy} className="btn-ghost py-1.5">
          {copied ? 'Copied' : 'Copy'}
        </button>

        {canLog && (
          <form
            action={async (formData) => {
              await logDraftedEmail(formData);
              setLogged(true);
              setTimeout(() => setLogged(false), 2500);
            }}
          >
            <input type="hidden" name="company_id" value={company.id} />
            <input type="hidden" name="contact_id" value={contactId} />
            <input type="hidden" name="subject" value={draft.subject} />
            <button className="btn-ghost py-1.5">{logged ? 'Logged' : 'Log as sent'}</button>
          </form>
        )}

        {contact && !contact.email && (
          <span className="text-xs text-warn">That contact has no email address on file.</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs text-black/45">
      {label}
      <input
        value={value.startsWith('[') ? '' : value}
        placeholder={value.startsWith('[') ? value : ''}
        onChange={(e) => onChange(e.target.value.trim() || value)}
        className="field mt-1 py-1.5"
      />
    </label>
  );
}
