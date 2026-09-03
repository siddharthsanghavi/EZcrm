'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { currentProfile, serverClient } from '@/lib/supabase';
import { ACTIVITY_TYPES, INTERESTS, STATUSES, TIERS } from '@/lib/types';
import { normalizeViewQuery } from '@/lib/views';

/** Signed in and on the allowlist. Says nothing about what they may change. */
async function requireProfile() {
  const profile = await currentProfile();
  if (!profile) redirect('/no-access');
  return { profile, supabase: await serverClient() };
}

/**
 * Every action that changes data starts here. RLS would reject a viewer anyway,
 * but failing fast keeps the error messages honest and avoids writing half a
 * record.
 *
 * A viewer reaching this point has gone around the UI — every write control is
 * hidden from them — so the message is short rather than apologetic.
 */
async function requireMember() {
  const ctx = await requireProfile();
  if (ctx.profile.role === 'viewer') {
    throw new Error('Your account has view-only access.');
  }
  return ctx;
}

/**
 * For the actions that delete companies. `requireAdmin` (further down, next to
 * the member-admin actions) returns null for a non-admin, which suits a form
 * that can show `{ error }`; these are <form action> handlers that resolve to
 * void, so they have to throw instead.
 *
 * Worth being loud about: RLS refuses a member's delete by matching no rows,
 * which looks exactly like success. Without this, someone without the rights
 * would be told their deletion went through when nothing happened.
 */
async function requireDeleter() {
  const ctx = await requireAdmin();
  if (!ctx) {
    throw new Error('Only admins can delete companies. File a deletion request instead.');
  }
  return ctx;
}

const text = (v: FormDataEntryValue | null) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

const oneOf = <T extends string>(v: FormDataEntryValue | null, allowed: readonly T[], fallback: T) =>
  allowed.includes(v as T) ? (v as T) : fallback;

// ------------------------------------------------------------------ companies

export async function saveCompany(formData: FormData) {
  const { profile, supabase } = await requireMember();

  const id = text(formData.get('id'));
  const name = text(formData.get('name'));
  if (!name) return { error: 'Company name is required.' };

  const employees = Number.parseInt(text(formData.get('employees')) ?? '', 10);

  const record = {
    name,
    website: text(formData.get('website')),
    industry: text(formData.get('industry')),
    status: oneOf(formData.get('status'), STATUSES, 'prospect'),
    interest: formData.getAll('interest').filter((i): i is string => INTERESTS.includes(i as never)),
    notes: text(formData.get('notes')),
    type: text(formData.get('type')),
    tier: text(formData.get('tier')),
    city: text(formData.get('city')),
    region: text(formData.get('region')),
    address: text(formData.get('address')),
    phone: text(formData.get('phone')),
    employees: Number.isFinite(employees) ? employees : null,
    owner_id: text(formData.get('owner_id')),
  };

  if (id) {
    const { error } = await supabase.from('companies').update(record).eq('id', id);
    if (error) return { error: error.message };
    revalidatePath(`/companies/${id}`);
  } else {
    const { data, error } = await supabase
      .from('companies')
      .insert({ ...record, created_by: profile.id })
      .select('id')
      .single();
    if (error) return { error: error.message };
    revalidatePath('/companies');
    redirect(`/companies/${data.id}`);
  }

  revalidatePath('/companies');
  return { ok: true };
}

export async function setCompanyStatus(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  await supabase
    .from('companies')
    .update({ status: oneOf(formData.get('status'), STATUSES, 'prospect') })
    .eq('id', id);

  revalidatePath('/companies');
  revalidatePath(`/companies/${id}`);
}

/**
 * Set (or clear) a company's tier.
 *
 * Tier is the club's own judgement of how promising a company is, and it
 * changes as you learn things — so it belongs next to status and owner rather
 * than buried in the edit form. An empty value clears it back to unrated, which
 * is a real state: a newly added company nobody has assessed yet.
 *
 * `tier_rank` is a generated column, so list ordering follows automatically.
 */
export async function setCompanyTier(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  const raw = text(formData.get('tier'));
  const tier = raw && TIERS.includes(raw as never) ? raw : null;

  await supabase.from('companies').update({ tier }).eq('id', id);

  revalidatePath(`/companies/${id}`);
  revalidatePath('/companies');
  revalidatePath('/map');
}

/** Assign (or unassign) a club member as the owner of a company. */
export async function setCompanyOwner(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  const owner = text(formData.get('owner_id'));
  await supabase.from('companies').update({ owner_id: owner }).eq('id', id);

  revalidatePath(`/companies/${id}`);
  revalidatePath('/companies');
  revalidatePath('/pipeline');
}

/** Assign a task to a club member. */
export async function setTaskAssignee(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  await supabase.from('tasks').update({ assignee_id: text(formData.get('assignee_id')) }).eq('id', id);
  revalidatePath('/tasks');
}

export async function deleteCompany(formData: FormData) {
  const { supabase } = await requireDeleter();
  const id = text(formData.get('id'));
  if (!id) return;

  // Used directly as a <form action>, which must resolve to void — so surface a
  // failure by throwing to the error boundary rather than returning it.
  const { error } = await supabase.from('companies').delete().eq('id', id);
  if (error) throw new Error(`Could not delete company: ${error.message}`);

  revalidatePath('/companies');
  redirect('/companies');
}

// ------------------------------------------------------------------- contacts

export async function saveContact(formData: FormData) {
  const { profile, supabase } = await requireMember();

  const id = text(formData.get('id'));
  const first_name = text(formData.get('first_name'));
  if (!first_name) return { error: 'First name is required.' };

  const record = {
    company_id: text(formData.get('company_id')),
    first_name,
    last_name: text(formData.get('last_name')),
    email: text(formData.get('email')),
    phone: text(formData.get('phone')),
    title: text(formData.get('title')),
    notes: text(formData.get('notes')),
    division: text(formData.get('division')),
  };

  const { error } = id
    ? await supabase.from('contacts').update(record).eq('id', id)
    : await supabase.from('contacts').insert({ ...record, created_by: profile.id });

  if (error) return { error: error.message };

  revalidatePath('/contacts');
  if (record.company_id) revalidatePath(`/companies/${record.company_id}`);
  return { ok: true };
}

/**
 * Where a contact sits in their company: who they report to, and which
 * division they are in.
 *
 * One action for both because they are one decision — "this person is in
 * Operations, under Marcus" — and two separate saves would let the reporting
 * line disagree with the division for however long the second one took.
 *
 * The database refuses a manager at another company and refuses a reporting
 * loop (see 013_deletions_audit_roles_and_org_chart.sql). Those come back as an error message
 * rather than a thrown page, because closing a loop is an easy honest mistake:
 * two people each make a sensible edit and the second one completes a circle.
 */
export async function setContactPlacement(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  const manager = text(formData.get('reports_to'));

  const { error } = await supabase
    .from('contacts')
    .update({
      reports_to: manager === id ? null : manager,
      division: text(formData.get('division')),
    })
    .eq('id', id);

  const company_id = text(formData.get('company_id'));
  if (company_id) revalidatePath(`/companies/${company_id}`);
  revalidatePath('/contacts');

  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteContact(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  await supabase.from('contacts').delete().eq('id', id);
  revalidatePath('/contacts');
}

/**
 * Record that a cold email went out.
 *
 * Called from the composer's "Log as sent", which is a claim by the member
 * rather than something the app observed — nothing here sends mail, so the app
 * cannot know. It writes the same kind of `activity` row the composer on the
 * company page writes, which is what keeps "last touched" honest and stops the
 * company drifting onto the going-cold list after somebody actually wrote to it.
 */
export async function logDraftedEmail(formData: FormData) {
  const { profile, supabase } = await requireMember();

  const company_id = text(formData.get('company_id'));
  const subject = text(formData.get('subject'));
  if (!company_id || !subject) return;

  const { error } = await supabase.from('activities').insert({
    company_id,
    contact_id: text(formData.get('contact_id')),
    type: 'email',
    subject,
    occurred_at: new Date().toISOString(),
    created_by: profile.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/companies/${company_id}`);
  revalidatePath('/');
  return { ok: true };
}

// ----------------------------------------------------------------- activities

export async function logActivity(formData: FormData) {
  const { profile, supabase } = await requireMember();

  const body = text(formData.get('body'));
  const subject = text(formData.get('subject'));
  if (!body && !subject) return { error: 'Write something to log.' };

  const company_id = text(formData.get('company_id'));
  const occurred = text(formData.get('occurred_at'));

  const { error } = await supabase.from('activities').insert({
    company_id,
    contact_id: text(formData.get('contact_id')),
    type: oneOf(formData.get('type'), ACTIVITY_TYPES, 'note'),
    subject,
    body,
    occurred_at: occurred ? new Date(occurred).toISOString() : new Date().toISOString(),
    created_by: profile.id,
  });

  if (error) return { error: error.message };

  if (company_id) revalidatePath(`/companies/${company_id}`);
  revalidatePath('/');
  return { ok: true };
}

// ---------------------------------------------------------------------- tasks

export async function saveTask(formData: FormData) {
  const { profile, supabase } = await requireMember();

  const title = text(formData.get('title'));
  if (!title) return { error: 'Task needs a title.' };

  const company_id = text(formData.get('company_id'));

  const { error } = await supabase.from('tasks').insert({
    title,
    details: text(formData.get('details')),
    due_date: text(formData.get('due_date')),
    company_id,
    contact_id: text(formData.get('contact_id')),
    assignee_id: text(formData.get('assignee_id')) ?? profile.id,
    created_by: profile.id,
  });

  if (error) return { error: error.message };

  revalidatePath('/tasks');
  revalidatePath('/');
  if (company_id) revalidatePath(`/companies/${company_id}`);
  return { ok: true };
}

export async function toggleTask(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  const done = formData.get('done') === 'true';
  await supabase
    .from('tasks')
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq('id', id);

  revalidatePath('/tasks');
  revalidatePath('/');
}

export async function deleteTask(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  await supabase.from('tasks').delete().eq('id', id);
  revalidatePath('/tasks');
}

// ------------------------------------------------------------ bulk operations

/** Read the checked company ids from a bulk form. */
const ids = (formData: FormData) =>
  formData.getAll('ids').filter((v): v is string => typeof v === 'string' && v.length > 0);

/**
 * Assign many companies at once. Dividing 1,200 companies between five people
 * one dropdown at a time is not a real workflow.
 */
export async function bulkApply(formData: FormData) {
  const op = formData.get('op');
  if (op === 'status') return bulkStatus(formData);
  if (op === 'tier') return bulkTier(formData);
  if (op === 'delete') return bulkDelete(formData);
  if (op === 'request-delete') return bulkRequestDeletion(formData);
  return bulkAssign(formData);
}

export async function bulkAssign(formData: FormData) {
  const { supabase } = await requireMember();
  const list = ids(formData);
  if (list.length === 0) return;

  const owner = text(formData.get('owner_id'));
  await supabase.from('companies').update({ owner_id: owner }).in('id', list);

  revalidatePath('/companies');
  revalidatePath('/pipeline');
  revalidatePath('/map');
}

/** Re-tier many companies at once — triage is the job this exists for. */
export async function bulkTier(formData: FormData) {
  const { supabase } = await requireMember();
  const list = ids(formData);
  if (list.length === 0) return;

  const raw = text(formData.get('tier'));
  const tier = raw && TIERS.includes(raw as never) ? raw : null;

  await supabase.from('companies').update({ tier }).in('id', list);

  revalidatePath('/companies');
  revalidatePath('/map');
}

export async function bulkStatus(formData: FormData) {
  const { supabase } = await requireMember();
  const list = ids(formData);
  if (list.length === 0) return;

  await supabase
    .from('companies')
    .update({ status: oneOf(formData.get('status'), STATUSES, 'prospect') })
    .in('id', list);

  revalidatePath('/companies');
  revalidatePath('/pipeline');
}

/**
 * Delete many companies at once, with their contacts, activity and tasks
 * following via `on delete cascade`.
 *
 * Admins only, and an admin may delete anything — so `kept` should always be 0
 * today. It is still counted and reported, because RLS refuses by matching no
 * rows rather than erroring: if the policy is ever narrowed again, this reports
 * the shortfall instead of silently implying the whole batch is gone.
 */
export async function bulkDelete(formData: FormData) {
  const { supabase } = await requireDeleter();
  const list = ids(formData);
  if (list.length === 0) return;

  const { data, error } = await supabase
    .from('companies')
    .delete()
    .in('id', list)
    .select('id');

  if (error) throw new Error(`Could not delete companies: ${error.message}`);

  const deleted = data?.length ?? 0;
  const kept = list.length - deleted;

  revalidatePath('/companies');
  revalidatePath('/pipeline');
  revalidatePath('/map');
  revalidatePath('/');

  const params = new URLSearchParams({ deleted: String(deleted) });
  if (kept > 0) params.set('kept', String(kept));
  redirect(`/companies?${params}`);
}

// ------------------------------------------------------ deletion requests

/**
 * A member cannot delete a company, so they ask.
 *
 * A pending request is unique per company at the database level, so two people
 * asking for the same deletion is not an error — the second ask simply joins
 * the first. `ignoreDuplicates` makes that quiet rather than a failure page.
 */
export async function requestCompanyDeletion(formData: FormData) {
  const { profile, supabase } = await requireMember();
  const company_id = text(formData.get('id'));
  if (!company_id) return;

  const { error } = await supabase.from('deletion_requests').upsert(
    {
      company_id,
      requested_by: profile.id,
      reason: text(formData.get('reason')),
      status: 'pending',
    },
    { onConflict: 'company_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(`Could not file the request: ${error.message}`);

  revalidatePath(`/companies/${company_id}`);
  revalidatePath('/deletions');
}

/** Ask for many at once, with one reason covering the batch. */
export async function bulkRequestDeletion(formData: FormData) {
  const { profile, supabase } = await requireMember();
  const list = ids(formData);
  if (list.length === 0) return;

  const reason = text(formData.get('reason'));
  const { error } = await supabase.from('deletion_requests').upsert(
    list.map((company_id) => ({
      company_id,
      requested_by: profile.id,
      reason,
      status: 'pending',
    })),
    { onConflict: 'company_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(`Could not file the requests: ${error.message}`);

  revalidatePath('/deletions');
  redirect(`/deletions?requested=${list.length}`);
}

/** Change your mind. Only your own, and only while it is still pending. */
export async function withdrawDeletionRequest(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  await supabase
    .from('deletion_requests')
    .update({ status: 'withdrawn', decided_at: new Date().toISOString() })
    .eq('id', id);

  revalidatePath('/deletions');
  revalidatePath('/companies');
}

/**
 * Approve: the company goes now.
 *
 * There is nothing to mark approved afterwards — the request row cascades away
 * with the company. What happened is recorded in `company_deletions`, where the
 * trigger copies the requester and their reason off this request first.
 */
export async function approveDeletionRequest(formData: FormData) {
  const { supabase } = await requireDeleter();
  const company_id = text(formData.get('company_id'));
  if (!company_id) return;

  const { error } = await supabase.from('companies').delete().eq('id', company_id);
  if (error) throw new Error(`Could not delete company: ${error.message}`);

  revalidatePath('/deletions');
  revalidatePath('/companies');
  revalidatePath('/pipeline');
  revalidatePath('/map');
  revalidatePath('/');
}

/** Decline, through the checked function so the decision is attributable. */
export async function declineDeletionRequest(formData: FormData) {
  const { supabase } = await requireDeleter();
  const id = text(formData.get('id'));
  if (!id) return;

  const { error } = await supabase.rpc('decide_deletion_request', {
    request: id,
    note: text(formData.get('note')),
  });
  if (error) throw new Error(`Could not decline the request: ${error.message}`);

  revalidatePath('/deletions');
  revalidatePath('/companies');
}

// ----------------------------------------------------------- saved views

export async function saveView(formData: FormData) {
  const { profile, supabase } = await requireMember();

  const name = text(formData.get('name'));
  if (!name) return { error: 'Give the view a name.' };

  // Only /companies has filters worth saving today. Pinning the path to a
  // known list keeps a saved view from becoming an open redirect.
  const path = formData.get('path') === '/map' ? '/map' : '/companies';

  const { error } = await supabase.from('saved_views').insert({
    name,
    path,
    query: normalizeViewQuery(text(formData.get('query')) ?? ''),
    // An unticked checkbox sends nothing at all, so absence means private.
    shared: formData.get('shared') === 'on',
    owner_id: profile.id,
  });

  if (error) return { error: error.message };

  revalidatePath(path);
  return { ok: true };
}

export async function deleteSavedView(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  // RLS decides whether this is allowed — a member can only drop their own.
  await supabase.from('saved_views').delete().eq('id', id);

  revalidatePath('/companies');
  revalidatePath('/map');
}

// ------------------------------------------------------------ member admin

/** Admin-only. RLS enforces this too; failing here just gives a clearer error. */
async function requireAdmin() {
  const profile = await currentProfile();
  if (!profile) redirect('/no-access');
  if (profile.role !== 'admin') return null;
  return { profile, supabase: await serverClient() };
}

export async function addAllowedEmail(formData: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: 'Only admins can add members.' };

  const email = text(formData.get('email'))?.toLowerCase();
  if (!email || !email.includes('@')) return { error: 'Enter a valid email address.' };

  const { error } = await ctx.supabase.from('allowed_emails').insert({
    email,
    note: text(formData.get('note')),
    // Decides what they become on first sign-in, so an invited viewer never
    // spends a day as a member.
    role: oneOf(formData.get('role'), ['viewer', 'member', 'admin'] as const, 'member'),
  });

  if (error) {
    return {
      error: error.code === '23505' ? 'That address is already on the list.' : error.message,
    };
  }

  revalidatePath('/members');
  return { ok: true };
}

/**
 * Removing someone takes two deletes: the allowlist stops them signing up again,
 * the profile is what actually grants access. Dropping only one leaves them in.
 */
export async function removeMember(formData: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return;

  const email = text(formData.get('email'));
  if (!email) return;

  const me = await currentProfile();
  if (me?.email.toLowerCase() === email.toLowerCase()) return; // don't lock yourself out

  await ctx.supabase.from('profiles').delete().eq('email', email);
  await ctx.supabase.from('allowed_emails').delete().eq('email', email);

  revalidatePath('/members');
}

export async function setMemberRole(formData: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return;

  const id = text(formData.get('id'));
  if (!id) return;

  // Goes through set_member_role rather than a direct update: `authenticated`
  // only holds column privileges on full_name, so a plain update would be
  // denied. That is deliberate — see migration 006. The function re-checks
  // admin and refuses to remove the last admin.
  await ctx.supabase.rpc('set_member_role', {
    target: id,
    new_role: oneOf(formData.get('role'), ['viewer', 'member', 'admin'] as const, 'member'),
  });

  revalidatePath('/members');
}

/** Anyone can set their own display name; it beats showing an email prefix. */
export async function updateMyName(formData: FormData) {
  // requireProfile, not requireMember: your own display name is yours to set
  // whatever your role, and RLS agrees — profiles_self_update matches on
  // auth.uid() rather than on write access.
  const { profile, supabase } = await requireProfile();
  await supabase
    .from('profiles')
    .update({ full_name: text(formData.get('full_name')) })
    .eq('id', profile.id);

  revalidatePath('/members');
  revalidatePath('/companies');
  revalidatePath('/pipeline');
}
