'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { currentProfile, serverClient } from '@/lib/supabase';
import { ACTIVITY_TYPES, INTERESTS, STATUSES } from '@/lib/types';

/**
 * Every action starts here. RLS would reject a non-member anyway, but failing
 * fast keeps the error messages honest and avoids writing half a record.
 */
async function requireMember() {
  const profile = await currentProfile();
  if (!profile) redirect('/no-access');
  return { profile, supabase: await serverClient() };
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
  const { supabase } = await requireMember();
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
  };

  const { error } = id
    ? await supabase.from('contacts').update(record).eq('id', id)
    : await supabase.from('contacts').insert({ ...record, created_by: profile.id });

  if (error) return { error: error.message };

  revalidatePath('/contacts');
  if (record.company_id) revalidatePath(`/companies/${record.company_id}`);
  return { ok: true };
}

export async function deleteContact(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  await supabase.from('contacts').delete().eq('id', id);
  revalidatePath('/contacts');
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
  return formData.get('op') === 'status' ? bulkStatus(formData) : bulkAssign(formData);
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

  const { error } = await ctx.supabase
    .from('allowed_emails')
    .insert({ email, note: text(formData.get('note')) });

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
    new_role: formData.get('role') === 'admin' ? 'admin' : 'member',
  });

  revalidatePath('/members');
}

/** Anyone can set their own display name; it beats showing an email prefix. */
export async function updateMyName(formData: FormData) {
  const { profile, supabase } = await requireMember();
  await supabase
    .from('profiles')
    .update({ full_name: text(formData.get('full_name')) })
    .eq('id', profile.id);

  revalidatePath('/members');
  revalidatePath('/companies');
  revalidatePath('/pipeline');
}
