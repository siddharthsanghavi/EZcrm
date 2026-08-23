export type Role = 'member' | 'admin';

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
};

export const STATUSES = [
  'prospect',
  'contacted',
  'in_conversation',
  'committed',
  'declined',
  'dormant',
] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  prospect: 'Prospect',
  contacted: 'Contacted',
  in_conversation: 'In conversation',
  committed: 'Committed',
  declined: 'Declined',
  dormant: 'Dormant',
};

/**
 * Chips are the one place a literal hue survives the theme swap — a status has
 * to stay recognisably the same colour in both themes. The light values are
 * pale-fill/dark-text; dark mode inverts that to a translucent fill with light
 * text, because a `-100` fill is glaring against a near-black card.
 */
export const STATUS_STYLES: Record<Status, string> = {
  prospect: 'bg-slate-100 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300',
  contacted: 'bg-blue-100 text-blue-800 dark:bg-blue-400/15 dark:text-blue-300',
  in_conversation: 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300',
  committed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300',
  declined: 'bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-300',
  dormant: 'bg-slate-100 text-slate-500 dark:bg-slate-400/10 dark:text-slate-400',
};

/**
 * Status as a dot plus a word, for dense lists.
 *
 * A pastel pill on every row turns a list into a field of colour and the eye
 * stops reading any of it. A 6px dot carries the same information at a tenth
 * of the ink, and the label stays plain text. Chips are still right where a
 * status is the subject rather than one column of many — the company header.
 */
export const STATUS_DOTS: Record<Status, string> = {
  prospect: 'bg-slate-400',
  contacted: 'bg-blue-500',
  in_conversation: 'bg-warn',
  committed: 'bg-accent',
  declined: 'bg-rose-500',
  dormant: 'bg-black/20',
};

export const INTERESTS = ['tour', 'sponsorship'] as const;
export type Interest = (typeof INTERESTS)[number];

export const ACTIVITY_TYPES = ['note', 'email', 'call', 'meeting', 'linkedin', 'other'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Confidence ratings from the source directory. Tier 1 is the shortlist. */
export const TIERS = ['Tier 1', 'Tier 2', 'Tier 3', 'Reference'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_STYLES: Record<string, string> = {
  'Tier 1': 'bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-300',
  'Tier 2': 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-300',
  // These two are already expressed in ink, so they invert on their own.
  'Tier 3': 'bg-black/[0.06] text-black/55',
  Reference: 'bg-black/[0.04] text-black/40',
};

export type Company = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  status: Status;
  interest: Interest[];
  notes: string | null;
  type: string | null;
  tier: string | null;
  city: string | null;
  region: string | null;
  address: string | null;
  phone: string | null;
  employees: number | null;
  owner_id: string | null;
  /** Last logged activity, maintained by trigger. Null means never touched. */
  last_touch_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Contact = {
  id: string;
  company_id: string | null;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  last_touch_at: string | null;
  created_at: string;
};

export type Activity = {
  id: string;
  company_id: string | null;
  contact_id: string | null;
  type: ActivityType;
  subject: string | null;
  body: string | null;
  occurred_at: string;
  created_by: string | null;
};

export type Task = {
  id: string;
  title: string;
  details: string | null;
  due_date: string | null;
  done: boolean;
  company_id: string | null;
  contact_id: string | null;
  assignee_id: string | null;
};

export type StatusEvent = {
  id: string;
  company_id: string;
  from_status: Status | null;
  to_status: Status;
  changed_by: string | null;
  changed_at: string;
};

/** Which stages flow into which, for the pipeline diagram. */
export const PIPELINE: Status[] = ['prospect', 'contacted', 'in_conversation', 'committed'];
export const PIPELINE_EXITS: Status[] = ['declined', 'dormant'];

/**
 * Stages where silence is a problem. A prospect nobody has called yet isn't
 * going cold — it hasn't started. Committed and declined are settled, and
 * dormant is already the label for "we stopped".
 */
export const ACTIVE_STAGES: Status[] = ['contacted', 'in_conversation'];

/** How long a company sits untouched before it counts as cold. */
export const COLD_AFTER_DAYS = 21;

/** Whole days since a touch. Null (never touched) sorts as the coldest. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
}

/**
 * Cold means: still in play, and nobody has logged anything in three weeks.
 * The database filter in the companies page has to express this in PostgREST
 * terms, so if you change the rule, change it in both places.
 */
export function isCold(status: Status, lastTouchAt: string | null): boolean {
  if (!ACTIVE_STAGES.includes(status)) return false;
  const days = daysSince(lastTouchAt);
  return days === null || days >= COLD_AFTER_DAYS;
}

/**
 * Relative time at minute resolution — "6m ago", "2h ago".
 *
 * `sinceLabel` floors to whole days, which is right for "last touched" on a
 * company but useless on an hourly chart: it renders a sign-in from two hours
 * ago as "today", so the header reads "last today". Use this wherever the
 * interesting scale is minutes and hours.
 */
export function preciseAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const secs = Math.floor((now - new Date(iso).getTime()) / 1000);

  if (secs < 45) return 'just now';
  if (secs < 90) return 'a minute ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** "12 days ago" / "never" — for a column that has to stay narrow. */
export function sinceLabel(iso: string | null | undefined): string {
  const days = daysSince(iso);
  if (days === null) return 'never';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Short label for whoever a record is assigned to. */
export function displayName(p: { full_name: string | null; email: string } | null | undefined) {
  if (!p) return 'Unassigned';
  return p.full_name?.trim() || p.email.split('@')[0];
}
