/**
 * viewer reads everything and writes nothing; member reads and writes; admin
 * also manages people and is the only role that can delete a company.
 * Enforced by RLS — see supabase/migrations/013_deletions_audit_roles_and_org_chart.sql —
 * so the UI gating below is a courtesy, not the security boundary.
 */
export type Role = 'viewer' | 'member' | 'admin';

export const ROLE_LABELS: Record<Role, string> = {
  viewer: 'viewer',
  member: 'member',
  admin: 'admin',
};

export const ROLE_HINTS: Record<Role, string> = {
  viewer: 'Can see everything. Cannot change anything.',
  member: 'Can add and edit companies, contacts, tasks and outreach.',
  admin: 'Everything a member can do, plus managing people and deleting companies.',
};

/** Whether this profile may change data at all. */
export function canWrite(p: { role: Role } | null | undefined) {
  return p?.role === 'member' || p?.role === 'admin';
}

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
  /** Their manager, another contact at the same company. Null means top level. */
  reports_to: string | null;
  /** Free text: "Operations", "North Plant". Null means no division given. */
  division: string | null;
  last_touch_at: string | null;
  created_at: string;
};

/** "Priya Nair", or just "Priya" when no surname was entered. */
export function contactName(c: { first_name: string; last_name: string | null }) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ');
}

export type OrgNode<T> = { contact: T; reports: OrgNode<T>[] };

/**
 * Build the reporting tree for one company.
 *
 * Anyone whose manager is missing from `contacts` — deleted, or at another
 * company — is treated as top level rather than dropped, because a contact you
 * cannot see is still a contact you can phone. A cycle in the data would
 * otherwise strand its members invisibly, so anything not reached from a root
 * is appended at the top too: the database refuses to create cycles, but data
 * that predates that rule still has to render.
 */
export function buildOrgTree<T extends { id: string; reports_to: string | null }>(
  contacts: T[],
): OrgNode<T>[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const nodes = new Map<string, OrgNode<T>>(contacts.map((c) => [c.id, { contact: c, reports: [] }]));
  const roots: OrgNode<T>[] = [];

  for (const c of contacts) {
    const node = nodes.get(c.id)!;
    const parent = c.reports_to && byId.has(c.reports_to) ? nodes.get(c.reports_to) : undefined;
    if (parent && parent !== node) parent.reports.push(node);
    else roots.push(node);
  }

  const seen = new Set<string>();
  const walk = (list: OrgNode<T>[]) => {
    for (const n of list) {
      if (seen.has(n.contact.id)) continue;
      seen.add(n.contact.id);
      walk(n.reports);
    }
  };
  walk(roots);

  for (const c of contacts) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      roots.push(nodes.get(c.id)!);
    }
  }

  return roots;
}

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

export const AUDIT_ENTITIES = [
  'company',
  'contact',
  'task',
  'activity',
  'deletion_request',
  'member',
  'data',
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  company: 'Companies',
  contact: 'Contacts',
  task: 'Tasks',
  activity: 'Outreach',
  deletion_request: 'Deletions',
  member: 'Members',
  data: 'Import / export',
};

export type AuditAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'assigned'
  | 'tier_changed'
  | 'completed'
  | 'reopened'
  | 'requested'
  | 'declined'
  | 'withdrawn'
  | 'invited'
  | 'removed'
  | 'role_changed'
  | 'renamed'
  | 'imported'
  | 'exported';

/**
 * One thing somebody did. Mostly written by trigger (013), so the feed covers
 * writes made outside the UI too; imports and exports are logged by the app
 * (014), because an export is a read and no trigger can see one.
 */
export type AuditEvent = {
  id: string;
  at: string;
  actor: string | null;
  entity: AuditEntity;
  action: AuditAction;
  entity_id: string | null;
  company_id: string | null;
  summary: string;
  details: Record<string, unknown> | null;
};

/**
 * A verb's colour. Destructive actions are the only ones that get a hue — in a
 * feed where every line is the same shape, "deleted" is the one you must not
 * skim past.
 */
export const AUDIT_ACTION_STYLES: Record<AuditAction, string> = {
  created: 'bg-black/[0.05] text-black/55',
  updated: 'bg-black/[0.05] text-black/55',
  deleted: 'bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-300',
  status_changed: 'bg-blue-100 text-blue-800 dark:bg-blue-400/15 dark:text-blue-300',
  assigned: 'bg-black/[0.05] text-black/55',
  tier_changed: 'bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-300',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300',
  reopened: 'bg-black/[0.05] text-black/55',
  requested: 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300',
  declined: 'bg-black/[0.05] text-black/55',
  withdrawn: 'bg-black/[0.05] text-black/55',
  // Membership and bulk data movement are the two things worth being able to
  // find months later, so neither is left in the neutral grey.
  invited: 'bg-blue-100 text-blue-800 dark:bg-blue-400/15 dark:text-blue-300',
  removed: 'bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-300',
  role_changed: 'bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-300',
  renamed: 'bg-black/[0.05] text-black/55',
  imported: 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300',
  exported: 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300',
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  created: 'added',
  updated: 'edited',
  deleted: 'deleted',
  status_changed: 'status',
  assigned: 'assigned',
  tier_changed: 'tier',
  completed: 'done',
  reopened: 'reopened',
  requested: 'requested',
  declined: 'declined',
  withdrawn: 'withdrawn',
  invited: 'invited',
  removed: 'removed',
  role_changed: 'role',
  renamed: 'renamed',
  imported: 'imported',
  exported: 'exported',
};

/** Who did it. Null actor means no session — the geocoder, or SQL run by hand. */
export function actorName(p: { full_name: string | null; email: string } | null | undefined) {
  if (!p) return 'Automatically';
  return p.full_name?.trim() || p.email.split('@')[0];
}

/**
 * A member's ask for a company to be deleted. Approved requests do not appear
 * here — they cascade away with the company and live on in CompanyDeletion.
 */
export type DeletionRequest = {
  id: string;
  company_id: string;
  requested_by: string | null;
  requested_at: string;
  reason: string | null;
  status: 'pending' | 'declined' | 'withdrawn';
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

/** One line of the deletion log. Written by trigger, never edited. */
export type CompanyDeletion = {
  id: string;
  company_id: string;
  company_name: string;
  snapshot: Record<string, unknown>;
  deleted_by: string | null;
  deleted_at: string;
  requested_by: string | null;
  request_reason: string | null;
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

/**
 * The club's outreach goal.
 *
 * Three targets rather than one, because the two questions a committee asks are
 * different sizes: "did we do anything today?" and "are we on track for the
 * year?". Each is optional — a club that only thinks in months leaves the other
 * two blank and sees only that.
 *
 * The vocabulary lives here rather than in `lib/goal.ts` because the settings
 * form and the dashboard card are client components: importing a constant from
 * a `server-only` module pulls that module into the browser bundle, and the
 * build says so in a way that takes a minute to read.
 */
export type GoalMetric = 'outreach' | 'contacted';

export type OutreachGoal = {
  metric: GoalMetric;
  daily: number | null;
  monthly: number | null;
  yearly: number | null;
};

export const GOAL_DEFAULTS: OutreachGoal = {
  metric: 'outreach',
  daily: null,
  monthly: null,
  yearly: null,
};

export const GOAL_METRICS: { id: GoalMetric; label: string; means: string }[] = [
  {
    id: 'outreach',
    label: 'Outreach logged',
    means: 'Every call, email or meeting logged against a company.',
  },
  {
    id: 'contacted',
    label: 'Companies first contacted',
    means: 'Companies moved out of Prospect for the first time.',
  },
];

export type GoalPeriod = 'daily' | 'monthly' | 'yearly';

export const GOAL_PERIOD_LABELS: Record<GoalPeriod, string> = {
  daily: 'Today',
  monthly: 'This month',
  yearly: 'This year',
};

export type GoalProgress = { period: GoalPeriod; target: number; done: number };
