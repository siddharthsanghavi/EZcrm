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

/**
 * How long a company may sit in each stage before it counts as going cold.
 *
 * One global threshold was too blunt: a week in "contacted" is fine, a month in
 * "in conversation" means the conversation stopped. Prospect has none — nobody
 * has promised a prospect anything — and the three end states are not waiting
 * on us at all.
 */
export type RottingRules = Partial<Record<Status, number>>;

export const ROTTING_DEFAULTS: RottingRules = {
  contacted: 21,
  in_conversation: 14,
  committed: 30,
};

/** Days a stage tolerates before a company is stale, or null if it never is. */
export function rotAfter(status: Status, rules: RottingRules | null | undefined): number | null {
  const configured = (rules ?? ROTTING_DEFAULTS)[status];
  return typeof configured === 'number' && configured > 0 ? configured : null;
}

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

/**
 * What a status is worth, for the weighted funnel.
 *
 * A club's pipeline chart counts logos; an advisor asks about money. These are
 * deliberately round numbers and deliberately not tuned: nobody here has the
 * hundreds of outcomes it would take to fit them, and a false precision like
 * 37% would invite exactly the trust the number has not earned.
 */
export const STATUS_PROBABILITY: Record<Status, number> = {
  prospect: 0.05,
  contacted: 0.15,
  in_conversation: 0.4,
  committed: 1,
  declined: 0,
  dormant: 0,
};

/** "$12,500" — whole dollars, because nobody pledges cents. */
export function money(amount: number | null | undefined) {
  if (amount === null || amount === undefined) return null;
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

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
  phone: string | null;
  employees: number | null;
  owner_id: string | null;
  /**
   * Every region and city across this company's locations, mirrored back by
   * trigger so the list page can filter and count without a join. Derived —
   * `company_locations` is the only place a location is edited. See
   * supabase/migrations/015_company_locations.sql.
   */
  location_regions: string[];
  location_cities: string[];
  /** What the club expects this to be worth, if anything. */
  amount: number | null;
  /** When it lands — required before a company can be marked committed. */
  close_date: string | null;
  /** Set means "off the working list, but not deleted". */
  archived_at: string | null;
  /** Last logged activity, maintained by trigger. Null means never touched. */
  last_touch_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * One place a company is. A company has zero or more, exactly one of which is
 * primary whenever it has any — the database enforces that, not this type.
 *
 * Location used to be eight columns on `companies`, which said a manufacturer
 * with three plants had one address. See
 * supabase/migrations/015_company_locations.sql.
 */
export type CompanyLocation = {
  id: string;
  company_id: string;
  /** "Head office", "Plant 2". Null when a single location needs no name. */
  label: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  county: string | null;
  /** Map grouping, derived from the point by `ez_area`. */
  area: string | null;
  latitude: number | null;
  longitude: number | null;
  /** 'address' once street-geocoded; 'city' while still a city centroid. */
  geo_precision: string | null;
  is_primary: boolean;
  sort: number;
  created_at: string;
  updated_at: string;
};

/** The one that stands in wherever there is room for a single place. */
export function primaryLocation<T extends { is_primary: boolean }>(
  locations: T[] | null | undefined,
): T | null {
  const all = locations ?? [];
  return all.find((l) => l.is_primary) ?? all[0] ?? null;
}

/** "Plant 2 — 14 Mill Road, Rome, GA", trimmed of whatever is missing. */
export function locationLabel(l: {
  label?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
}): string {
  const place = [l.address, l.city, l.region].filter(Boolean).join(', ');
  if (l.label && place) return `${l.label} — ${place}`;
  return l.label || place || 'Unnamed location';
}

/** The short form for a list row or a search hit: city, else region. */
export function locationSummary(l: { city?: string | null; region?: string | null } | null) {
  if (!l) return null;
  return l.city || l.region || null;
}

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

// ----------------------------------------------------------------- the clock

/**
 * The club's time zone, and "today" reckoned in it.
 *
 * A Server Component runs on UTC on Vercel, so `new Date().toISOString()` is
 * tomorrow for a club in Georgia from 8pm onwards: tasks due today went overdue
 * at dinner, and the daily outreach goal reset four hours early. Everything
 * that needs a calendar date on the server asks these instead of the clock.
 *
 * Stored on the `club` settings row as an IANA name ("America/New_York"). The
 * default is UTC, which is exactly what the app did before the setting existed
 * — a club that has not chosen one sees no change, and one that has sees the
 * right day.
 */
export const DEFAULT_TIME_ZONE = 'UTC';

/** True for an IANA zone this runtime can format in; false for typos. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone to use: the configured one if it is real, else the default. */
export function clubTimeZone(configured: string | null | undefined): string {
  return isValidTimeZone(configured) ? configured : DEFAULT_TIME_ZONE;
}

/** Calendar parts of an instant, as a wall clock in `tz` would show them. */
function partsIn(tz: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** "2026-09-21" — the date it is in `tz` right now (or at `at`). */
export function todayIn(tz: string, at: Date = new Date()): string {
  const { year, month, day } = partsIn(tz, at);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The instant at which a given wall-clock date/time occurs in `tz`.
 *
 * Guess it as if the wall clock were UTC, measure how far off that guess lands
 * when read back in `tz`, and correct by that much. One more pass catches the
 * hour on either side of a DST change, where the first correction can itself
 * be an hour out.
 */
function instantOf(tz: string, year: number, month: number, day: number): Date {
  let guess = Date.UTC(year, month - 1, day);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(tz, new Date(guess));
    const readBack = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess -= readBack - Date.UTC(year, month - 1, day);
  }
  return new Date(guess);
}

/** Midnight at the start of today, this month, or this year — in `tz`. */
export function startOfPeriodIn(tz: string, period: 'daily' | 'monthly' | 'yearly', at: Date = new Date()): Date {
  const { year, month, day } = partsIn(tz, at);
  if (period === 'daily') return instantOf(tz, year, month, day);
  if (period === 'monthly') return instantOf(tz, year, month, 1);
  return instantOf(tz, year, 1, 1);
}

/** Whole days since a touch. Null (never touched) sorts as the coldest. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
}

/**
 * Cold means: this stage was waiting on us, and nobody has done anything for
 * longer than that stage tolerates.
 *
 * The threshold is per stage now (see ROTTING_DEFAULTS), which is why the rules
 * are passed in: they are a club setting, not a constant. Committed counts too
 * — a company that said yes in March and has heard nothing since is exactly the
 * one you lose.
 *
 * The dashboard and the companies page both express the same rule in PostgREST
 * terms to filter server-side, so if you change this, change `coldFilter` with
 * it.
 */
export function isCold(
  status: Status,
  lastTouchAt: string | null,
  rules?: RottingRules | null,
): boolean {
  const after = rotAfter(status, rules);
  if (after === null) return false;
  const days = daysSince(lastTouchAt);
  return days === null || days >= after;
}

/** Stages that can go cold at all, given the club's rules. */
export function rottingStages(rules?: RottingRules | null): Status[] {
  return STATUSES.filter((s) => rotAfter(s, rules) !== null);
}

/**
 * `isCold` in PostgREST terms, for `.or()`.
 *
 * Each stage tolerates a different silence, so this is an OR of one clause per
 * stage. Anywhere that needs the going-cold list has to filter server-side —
 * fetching every company and filtering in TypeScript silently truncates at the
 * API's default row cap — so both callers share this one expression. Change it
 * and `isCold` together.
 */
export function coldFilter(rules?: RottingRules | null): string {
  return rottingStages(rules)
    .map((s) => {
      const before = new Date(Date.now() - (rotAfter(s, rules) ?? 0) * 864e5).toISOString();
      return `and(status.eq.${s},or(last_touch_at.is.null,last_touch_at.lt.${before}))`;
    })
    .join(',');
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
