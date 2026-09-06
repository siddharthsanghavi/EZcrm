'use client';

import { useState } from 'react';
import { attachmentUrl, deleteAttachment, recordAttachment } from '@/app/actions';
import { browserClient } from '@/lib/supabase-browser';

export type AttachmentRow = {
  id: string;
  name: string;
  path: string;
  mime: string | null;
  size_bytes: number | null;
  created_at: string;
  profiles: { full_name: string | null; email: string } | null;
};

const MAX_BYTES = 10 * 1024 * 1024;

function readableSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files for one company: signed agreements, tour waivers, a sponsorship deck.
 *
 * The upload goes straight from this browser to Supabase Storage and only then
 * records a row, which keeps a 10 MB PDF out of a Vercel request body entirely.
 * The bucket is private, so downloads mint a signed URL that expires in a
 * minute — a link pasted into a group chat is dead before anyone else opens it.
 */
export function Attachments({
  companyId,
  files,
  writable,
}: {
  companyId: string;
  files: AttachmentRow[];
  writable: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);

    if (file.size > MAX_BYTES) {
      setError(`${file.name} is ${readableSize(file.size)}. The limit is 10 MB.`);
      return;
    }

    setBusy(true);
    try {
      // Path is namespaced by company and prefixed with a random segment: two
      // people uploading "agreement.pdf" on the same day must not collide, and
      // a guessable path in a private bucket is still a bad habit.
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);
      const path = `${companyId}/${crypto.randomUUID()}-${safe}`;

      const { error: uploadError } = await browserClient()
        .storage.from('attachments')
        .upload(path, file, { contentType: file.type || undefined, upsert: false });

      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const body = new FormData();
      body.set('company_id', companyId);
      body.set('path', path);
      body.set('name', file.name);
      body.set('mime', file.type);
      body.set('size_bytes', String(file.size));

      const result = await recordAttachment(body);
      if (result?.error) setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const open = async (path: string) => {
    const result = await attachmentUrl(path);
    if ('url' in result && result.url) window.open(result.url, '_blank', 'noopener');
    else setError('error' in result ? result.error ?? 'Could not open that file.' : null);
  };

  return (
    <div className="space-y-2">
      {files.length > 0 ? (
        <ul className="divide-y divide-black/5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
              <button
                type="button"
                onClick={() => open(f.path)}
                className="min-w-0 flex-1 text-left hover:underline"
              >
                <span className="block truncate font-medium">{f.name}</span>
                <span className="text-xs text-black/45">
                  {readableSize(f.size_bytes)}
                  {f.profiles && ` · ${f.profiles.full_name ?? f.profiles.email.split('@')[0]}`}
                </span>
              </button>

              {writable && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Delete ${f.name}? This cannot be undone.`)) return;
                    const body = new FormData();
                    body.set('id', f.id);
                    body.set('company_id', companyId);
                    const result = await deleteAttachment(body);
                    if (result?.error) setError(result.error);
                  }}
                  className="shrink-0 text-xs text-black/30 hover:text-danger"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-black/45">
          Nothing here yet. Signed agreements and waivers belong on the company, not in one
          member&apos;s Drive.
        </p>
      )}

      {writable && (
        <label className="block text-xs text-black/45">
          <span className="sr-only">Upload a file</span>
          <input
            type="file"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = '';
            }}
            className="w-full text-xs text-black/55 file:mr-2 file:rounded file:border file:border-black/15 file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-ink"
          />
          <span className="mt-1 block text-[11px] text-black/35">
            {busy ? 'Uploading…' : 'Up to 10 MB. Private to the club.'}
          </span>
        </label>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
