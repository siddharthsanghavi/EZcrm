/**
 * Saved-view helpers.
 *
 * These live outside `app/actions.ts` because that file is `'use server'`, and
 * every export from a server-action module has to be an async action — a plain
 * helper exported from there is a build error.
 */

/** Filters that make up a view. `page` is deliberately not one of them. */
export const VIEW_PARAMS = ['status', 'tier', 'type', 'region', 'cap', 'owner', 'cold', 'q'] as const;

/**
 * Reduce a querystring to just the filters, in a fixed order, so the same set
 * of filters always produces the same string. Without this, a view saved as
 * `tier=Tier+1&status=contacted` would never match the identical view arrived
 * at in the other order, and nothing would ever highlight as active.
 */
export function normalizeViewQuery(input: string): string {
  const from = new URLSearchParams(input);
  const out = new URLSearchParams();
  for (const key of VIEW_PARAMS) {
    const value = from.get(key);
    if (value) out.set(key, value);
  }
  return out.toString();
}

/** The link a saved view points at. */
export function viewHref(path: string, query: string): string {
  return query ? `${path}?${query}` : path;
}

export type SavedView = {
  id: string;
  name: string;
  path: string;
  query: string;
  shared: boolean;
  owner_id: string | null;
};
