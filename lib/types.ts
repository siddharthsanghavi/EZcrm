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

export const STATUS_STYLES: Record<Status, string> = {
  prospect: 'bg-slate-100 text-slate-700',
  contacted: 'bg-blue-100 text-blue-800',
  in_conversation: 'bg-amber-100 text-amber-800',
  committed: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-rose-100 text-rose-800',
  dormant: 'bg-slate-100 text-slate-500',
};

export const INTERESTS = ['tour', 'sponsorship'] as const;
export type Interest = (typeof INTERESTS)[number];

export const ACTIVITY_TYPES = ['note', 'email', 'call', 'meeting', 'linkedin', 'other'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Confidence ratings from the source directory. Tier 1 is the shortlist. */
export const TIERS = ['Tier 1', 'Tier 2', 'Tier 3', 'Reference'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_STYLES: Record<string, string> = {
  'Tier 1': 'bg-violet-100 text-violet-800',
  'Tier 2': 'bg-sky-100 text-sky-800',
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
