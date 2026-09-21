'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { logDraftedEmail } from '@/app/actions';
import {
  contactName,
  draftEmail,
  mailtoLink,
  suggestTemplate,
  type ClubDetails,
  type EmailTemplate,
} from '@/lib/cold-email';
import type { Company, Contact } from '@/lib/types';

type Person = Pick<Contact, 'id' | 'first_name' | 'last_name' | 'title' | 'email'>;

export function ColdEmail({
  company,
  contacts,
  sender,
  templates,
  club,
  canLog,
}: {
  company: Pick<Company, 'id' | 'name' | 'type' | 'industry' | 'interest' | 'tier' | 'status'> & {
    /** From the company's primary location. */
    city: string | null;
  };
  contacts: Person[];
  sender: { name: string; email: string };
  /** The club's own letters, from /settings. */
  templates: EmailTemplate[];
  club: ClubDetails;
  /** Viewers can draft and copy; logging it as outreach is a write. */
  canLog: boolean;
}) {
  const withEmail = contacts.filter((c) => c.email);
  const [templateId, setTemplateId] = useState<string>(
    () => suggestTemplate(templates, company)?.id ?? '',
  );
  const [contactId, setContactId] = useState<string>(() => withEmail[0]?.id ?? '');
  const [copied, setCopied] = useState(false);
  const [logged, setLogged] = useState(false);

  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const contact = contacts.find((c) => c.id === contactId) ?? null;

  const draft = useMemo(
    () => (template ? draftEmail(template, { company, contact, sender, club }) : null),
    [template, company, contact, sender, club],
  );

  const incomplete = Object.values(club).some((v) => v.startsWith('['));

  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (!template || !draft) {
    return (
      <p className="text-sm text-black/45">
        No email templates yet.{' '}
        <Link href="/settings?tab=templates" className="underline">
          Add one in settings
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={template.id}
          onChange={(e) => setTemplateId(e.target.value)}
          aria-label="Template"
          className="field w-52 py-1.5"
        >
          {templates.map((t) => (
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

        <Link href="/settings?tab=templates" className="text-xs text-black/45 hover:text-ink">
          Edit templates
        </Link>
      </div>

      {template.guidance && <p className="text-xs text-black/45">{template.guidance}</p>}

      {incomplete && (
        <p className="text-xs text-warn">
          Your{' '}
          <Link href="/settings?tab=club" className="underline">
            club details
          </Link>{' '}
          are still placeholders, and they are in this draft.
        </p>
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

