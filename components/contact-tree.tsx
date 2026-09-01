'use client';

import { useState } from 'react';
import { setContactPlacement } from '@/app/actions';
import { buildOrgTree, contactName, type Contact, type OrgNode } from '@/lib/types';

type Person = Pick<
  Contact,
  'id' | 'company_id' | 'first_name' | 'last_name' | 'title' | 'email' | 'phone' | 'reports_to' | 'division'
>;

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
  const [editing, setEditing] = useState<string | null>(null);

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
  editing: string | null;
  setEditing: (id: string | null) => void;
}) {
  const c = node.contact;
  const open = editing === c.id;

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
          <button
            type="button"
            onClick={() => setEditing(c.id)}
            className="shrink-0 text-xs text-black/30 opacity-0 transition group-hover:opacity-100 hover:text-ink"
          >
            Place
          </button>
        )}
      </div>

      {open && (
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
