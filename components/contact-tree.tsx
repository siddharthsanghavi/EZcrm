'use client';

import { useState } from 'react';
import { saveContact, setContactPlacement } from '@/app/actions';
import { buildOrgTree, contactName, type Contact, type OrgNode } from '@/lib/types';

type Person = Pick<
  Contact,
  'id' | 'company_id' | 'first_name' | 'last_name' | 'title' | 'email' | 'phone' | 'reports_to' | 'division'
>;

type Editing = { id: string; mode: 'place' | 'details' } | null;

/**
 * The contacts at one company, drawn as who reports to whom.
 *
 * Divisions come first, because that is the coarser cut: at a factory the
 * Operations people and the Marketing people rarely share a manager, and
 * grouping by division before drawing reporting lines matches how somebody
 * describes their own company out loud. Within a division, indentation carries
 * the reporting line — no boxes and connectors, which need horizontal room this
 * sidebar does not have and add nothing at six people.
 *
 * Contacts with no division sit in a final unlabelled group rather than a group
 * called "None": most companies will never use divisions at all, and those
 * should look like a plain list, which is exactly what one unlabelled group is.
 */
export function ContactTree({
  contacts,
  companyId,
  writable,
}: {
  contacts: Person[];
  companyId: string;
  writable: boolean;
}) {
  // Which row is open, and which of the two panels. They stay separate because
  // they are separate decisions with separate rules: who somebody reports to is
  // checked for loops against the rest of the tree, their job title is not.
  const [editing, setEditing] = useState<Editing>(null);

  if (contacts.length === 0) return null;

  // Preserve first-seen order so the groups do not reshuffle on every edit.
  const divisions: (string | null)[] = [];
  for (const c of contacts) {
    const d = c.division?.trim() || null;
    if (!divisions.some((x) => x === d)) divisions.push(d);
  }
  divisions.sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));

  return (
    <div className="divide-y divide-black/5">
      {divisions.map((division) => {
        const members = contacts.filter((c) => (c.division?.trim() || null) === division);

        return (
          <div key={division ?? '—'}>
            {division && (
              <div className="bg-black/[0.02] px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-black/40">
                {division}
              </div>
            )}
            <ul>
              {buildOrgTree(members).map((node) => (
                <Branch
                  key={node.contact.id}
                  node={node}
                  depth={0}
                  contacts={contacts}
                  companyId={companyId}
                  writable={writable}
                  editing={editing}
                  setEditing={setEditing}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Branch({
  node,
  depth,
  contacts,
  companyId,
  writable,
  editing,
  setEditing,
}: {
  node: OrgNode<Person>;
  depth: number;
  contacts: Person[];
  companyId: string;
  writable: boolean;
  editing: Editing;
  setEditing: (next: Editing) => void;
}) {
  const c = node.contact;
  const open = editing?.id === c.id ? editing.mode : null;

  // Anyone in this person's own subtree would close a loop, so they are not
  // offered as a manager. The database refuses it too; leaving it out of the
  // list means nobody has to discover that by being told off.
  const descendants = new Set<string>();
  const collect = (n: OrgNode<Person>) => {
    descendants.add(n.contact.id);
    n.reports.forEach(collect);
  };
  collect(node);

  return (
    <li>
      <div
        className="group flex items-baseline gap-2 px-5 py-2.5 text-sm hover:bg-black/[0.02]"
        style={{ paddingLeft: `${1.25 + depth * 1.1}rem` }}
      >
        {depth > 0 && (
          <span aria-hidden className="-ml-3 select-none text-black/25">
            └
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="font-medium">{contactName(c)}</div>
          {c.title && <div className="text-xs text-black/50">{c.title}</div>}
          {c.email && (
            <a href={`mailto:${c.email}`} className="text-xs text-black/60 underline">
              {c.email}
            </a>
          )}
          {c.phone && <div className="text-xs text-black/50">{c.phone}</div>}
        </div>

        {writable && !open && (
          <div className="flex shrink-0 gap-2 opacity-0 transition group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setEditing({ id: c.id, mode: 'details' })}
              className="text-xs text-black/30 hover:text-ink"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setEditing({ id: c.id, mode: 'place' })}
              className="text-xs text-black/30 hover:text-ink"
            >
              Place
            </button>
          </div>
        )}
      </div>

      {open === 'details' && (
        <form
          action={async (formData) => {
            await saveContact(formData);
            setEditing(null);
          }}
          className="space-y-2 border-y border-black/[0.07] bg-black/[0.02] px-5 py-3"
        >
          {/* Only the fields shown are submitted, and saveContact patches only
              what it is given — so this form cannot blank their division, their
              notes, or the company they belong to. */}
          <input type="hidden" name="id" value={c.id} />

          <div className="flex gap-2">
            <label className="block flex-1 text-xs text-black/45">
              First name
              <input
                name="first_name"
                required
                defaultValue={c.first_name}
                className="field mt-1 py-1.5"
              />
            </label>
            <label className="block flex-1 text-xs text-black/45">
              Last name
              <input name="last_name" defaultValue={c.last_name ?? ''} className="field mt-1 py-1.5" />
            </label>
          </div>

          <label className="block text-xs text-black/45">
            Title
            <input
              name="title"
              defaultValue={c.title ?? ''}
              placeholder="Operations Manager"
              className="field mt-1 py-1.5"
            />
          </label>

          <label className="block text-xs text-black/45">
            Email
            <input
              name="email"
              type="email"
              defaultValue={c.email ?? ''}
              className="field mt-1 py-1.5"
            />
          </label>

          <label className="block text-xs text-black/45">
            Phone
            <input name="phone" defaultValue={c.phone ?? ''} className="field mt-1 py-1.5" />
          </label>

          <div className="flex items-center gap-2">
            <button className="btn-ghost py-1.5 text-xs">Save</button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-xs text-black/40 hover:text-ink"
            >
              Cancel
            </button>
            {/* A promotion usually moves somebody up the tree as well, and that
                lives in the other panel — say so rather than let them look. */}
            <button
              type="button"
              onClick={() => setEditing({ id: c.id, mode: 'place' })}
              className="ml-auto text-xs text-black/35 hover:text-ink"
            >
              Reporting line →
            </button>
          </div>
        </form>
      )}

      {open === 'place' && (
        <form
          action={async (formData) => {
            await setContactPlacement(formData);
            setEditing(null);
          }}
          className="space-y-2 border-y border-black/[0.07] bg-black/[0.02] px-5 py-3"
        >
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="company_id" value={companyId} />

          <label className="block text-xs text-black/45">
            Reports to
            <select name="reports_to" defaultValue={c.reports_to ?? ''} className="field mt-1 py-1.5">
              <option value="">Nobody — top of the tree</option>
              {contacts
                .filter((other) => !descendants.has(other.id))
                .map((other) => (
                  <option key={other.id} value={other.id}>
                    {contactName(other)}
                    {other.title ? ` — ${other.title}` : ''}
                  </option>
                ))}
            </select>
          </label>

          <label className="block text-xs text-black/45">
            Division
            <input
              name="division"
              defaultValue={c.division ?? ''}
              placeholder="Operations, North Plant…"
              className="field mt-1 py-1.5"
            />
          </label>

          <div className="flex gap-2">
            <button className="btn-ghost py-1.5 text-xs">Save</button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-xs text-black/40 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {node.reports.length > 0 && (
        <ul>
          {node.reports.map((child) => (
            <Branch
              key={child.contact.id}
              node={child}
              depth={depth + 1}
              contacts={contacts}
              companyId={companyId}
              writable={writable}
              editing={editing}
              setEditing={setEditing}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
