'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { deleteTemplate, importTemplates, saveTemplate } from '@/app/actions';
import {
  MERGE_FIELDS,
  draftEmail,
  render,
  type ClubDetails,
  type EmailTemplate,
} from '@/lib/cold-email';
import { STATUSES, STATUS_LABELS, type Status } from '@/lib/types';

type State = { error?: string; ok?: boolean; imported?: number; warnings?: string[] } | null;

/** A company that does not exist, for previewing a letter against something. */
const SAMPLE = {
  name: 'Millgate Chocolate Co.',
  type: 'Factory',
  city: 'York',
  industry: 'Food & drink',
  interest: ['tour'] as never,
  tier: 'Tier 1',
  status: 'prospect' as Status,
};

const SAMPLE_CONTACT = {
  first_name: 'Harriet',
  last_name: 'Vance',
  title: 'Site Director',
  email: 'harriet@example.com',
};

export function TemplateEditor({
  templates,
  club,
  me,
  canEdit,
}: {
  templates: EmailTemplate[];
  club: ClubDetails;
  me: { name: string; email: string };
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<EmailTemplate | 'new' | null>(null);

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
          <h2 className="text-sm font-semibold">Templates · {templates.length}</h2>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(editing === 'new' ? null : 'new')}
              className="text-xs text-black/45 hover:text-ink"
            >
              {editing === 'new' ? 'Cancel' : 'New template'}
            </button>
          )}
        </div>

        {editing === 'new' && (
          <div className="border-b border-black/10 bg-black/[0.02] p-5">
            <Form template={null} club={club} me={me} onDone={() => setEditing(null)} />
          </div>
        )}

        {templates.length > 0 ? (
          <ul className="divide-y divide-black/5">
            {templates.map((t) => {
              const open = editing !== 'new' && editing?.id === t.id;
              return (
                <li key={t.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t.name}</div>
                      <div className="text-xs text-black/45">
                        {t.guidance || 'No guidance written.'}
                        {t.suggest_for && (
                          <> · suggested for {STATUS_LABELS[t.suggest_for as Status] ?? t.suggest_for}</>
                        )}
                      </div>
                    </div>

                    {canEdit && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setEditing(open ? null : t)}
                          className="text-xs text-black/45 hover:text-ink"
                        >
                          {open ? 'Close' : 'Edit'}
                        </button>
                        <form action={deleteTemplate}>
                          <input type="hidden" name="id" value={t.id} />
                          <button
                            className="text-xs text-black/30 hover:text-danger"
                            onClick={(e) => {
                              if (!window.confirm(`Delete the "${t.name}" template?`)) {
                                e.preventDefault();
                              }
                            }}
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    )}
                  </div>

                  {open && (
                    <div className="border-t border-black/10 bg-black/[0.02] p-5">
                      <Form template={t} club={club} me={me} onDone={() => setEditing(null)} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-black/45">
            No templates yet. The migration seeds four; if this is empty, it has not been run.
          </p>
        )}
      </div>

      <MarkdownPanel canEdit={canEdit} />
    </div>
  );
}

function Form({
  template,
  club,
  me,
  onDone,
}: {
  template: EmailTemplate | null;
  club: ClubDetails;
  me: { name: string; email: string };
  onDone: () => void;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  const [subject, setSubject] = useState(template?.subject ?? 'Student visit to {{company}}?');
  const [body, setBody] = useState(template?.body ?? '{{greeting}}\n\n\n\n{{signature}}');

  /**
   * Put the caret back after an insertion.
   *
   * It has to happen here rather than in the click handler: setting state
   * re-renders the textarea, and React's own value update lands *after* the
   * handler, dropping the caret at the end of the letter. Somebody inserting
   * three fields in a row would be typing at the bottom every time.
   */
  useEffect(() => {
    const at = caretRef.current;
    if (at === null || !bodyRef.current) return;
    caretRef.current = null;
    bodyRef.current.focus();
    bodyRef.current.setSelectionRange(at, at);
  }, [body]);

  const [state, action, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const result = (await saveTemplate(formData)) ?? null;
    if (result?.ok) onDone();
    return result;
  }, null);

  /**
   * Insert at the caret rather than appending: somebody clicking {{company}}
   * has their cursor exactly where they want the name, and an insert that lands
   * at the end instead is worse than no button at all.
   */
  const insert = (field: string) => {
    const el = bodyRef.current;
    const token = `{{${field}}}`;
    if (!el) return setBody((b) => b + token);

    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;

    setBody(body.slice(0, start) + token + body.slice(end));
    caretRef.current = start + token.length;
  };

  const preview = draftEmail(
    { ...(template ?? ({} as EmailTemplate)), subject, body },
    { company: SAMPLE as never, contact: SAMPLE_CONTACT, sender: me, club },
  );

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-2">
      {template && <input type="hidden" name="id" value={template.id} />}

      <div className="space-y-3">
        <label className="block text-xs text-black/45">
          Name
          <input
            name="name"
            required
            defaultValue={template?.name ?? ''}
            placeholder="Ask for a tour"
            className="field mt-1"
          />
        </label>

        <label className="block text-xs text-black/45">
          When to use it
          <input
            name="guidance"
            defaultValue={template?.guidance ?? ''}
            placeholder="First approach, when you want to visit."
            className="field mt-1"
          />
        </label>

        <div className="flex gap-2">
          <label className="block flex-1 text-xs text-black/45">
            Suggest for
            <select
              name="suggest_for"
              defaultValue={template?.suggest_for ?? ''}
              className="field mt-1"
            >
              <option value="">Never — pick it by hand</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block w-24 text-xs text-black/45">
            Order
            <input
              name="sort"
              type="number"
              defaultValue={template?.sort ?? 100}
              className="field mt-1"
            />
          </label>
        </div>

        <label className="block text-xs text-black/45">
          Subject
          <input
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="field mt-1"
          />
        </label>

        <label className="block text-xs text-black/45">
          Body
          <textarea
            ref={bodyRef}
            name="body"
            rows={16}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="field mt-1 font-mono text-[13px] leading-relaxed"
          />
        </label>

        <div>
          <p className="text-xs text-black/45">Click to insert at the cursor:</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {MERGE_FIELDS.map((f) => (
              <button
                key={f.field}
                type="button"
                title={f.means}
                onClick={() => insert(f.field)}
                className="rounded border border-black/10 bg-black/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-black/60 transition hover:border-black/25 hover:text-ink"
              >
                {f.field}
              </button>
            ))}
          </div>
        </div>

        {state?.error && <p className="text-sm text-danger">{state.error}</p>}

        <div className="flex gap-2">
          <button className="btn-primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save template'}
          </button>
          <button type="button" onClick={onDone} className="btn-ghost">
            Cancel
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-black/45">
          Preview, against a made-up company — this is what a member would see before sending.
        </p>
        <div className="card overflow-hidden">
          <div className="border-b border-black/10 px-4 py-2 text-sm">
            <span className="text-black/45">Subject: </span>
            {preview.subject}
          </div>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed text-black/75">
{preview.body}
          </pre>
        </div>
        {/* Left as typed rather than blanked, so a stray brace is visible here
            instead of eating the rest of the sentence in somebody's inbox. */}
        {/\{\{\s*[a-z_]+\s*\}\}/i.test(render(body, {})) && (
          <p className="text-xs text-warn">
            Some {'{{fields}}'} above are not ones EZcrm knows. They will be sent exactly as written.
          </p>
        )}
      </div>
    </form>
  );
}

function MarkdownPanel({ canEdit }: { canEdit: boolean }) {
  const [markdown, setMarkdown] = useState('');
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await importTemplates(formData)) ?? null,
    null,
  );

  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold">Markdown import and export</h2>
      <p className="mt-1 text-sm text-black/55">
        Export writes every template to one file you can edit anywhere, keep in a repository, or
        hand to next year&apos;s committee. Import matches on each template&apos;s slug: existing
        ones are updated, new ones added, and anything the file does not mention is left alone.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <a href="/api/templates" className="btn-ghost">
          Export templates.md
        </a>
      </div>

      {canEdit && (
        <form action={action} className="mt-4 space-y-2">
          <label className="block text-xs text-black/45">
            Paste Markdown, or choose a file
            <textarea
              name="markdown"
              rows={8}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder="## Ask for a tour&#10;&#10;- slug: tour&#10;&#10;### Subject&#10;&#10;…"
              className="field mt-1 font-mono text-[13px]"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".md,text/markdown,text/plain"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setMarkdown(await file.text());
              }}
              className="text-xs text-black/55 file:mr-2 file:rounded file:border file:border-black/15 file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-ink"
            />
            <button className="btn-ghost" disabled={pending || !markdown.trim()}>
              {pending ? 'Importing…' : 'Import'}
            </button>
          </div>

          {state?.error && <p className="text-sm text-danger">{state.error}</p>}
          {state?.ok && (
            <div className="text-sm text-success">
              Imported {state.imported} template{state.imported === 1 ? '' : 's'}.
              {(state.warnings ?? []).map((w) => (
                <div key={w} className="text-warn">
                  {w}
                </div>
              ))}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
