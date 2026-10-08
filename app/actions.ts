'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { currentProfile, serverClient } from '@/lib/supabase';
import {
  ACTIVITY_TYPES,
  DEFAULT_TIME_ZONE,
  INTERESTS,
  STATUSES,
  TIERS,
  isValidTimeZone,
} from '@/lib/types';
import { normalizeViewQuery } from '@/lib/views';
import { slugify, templatesFromMarkdown } from '@/lib/cold-email';

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

/** A pledged amount, or null. Strips whatever a person typed around the number. */
const money = (v: FormDataEntryValue | null) => {
  const raw = text(v)?.replace(/[^0-9.]/g, '');
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

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
    phone: text(formData.get('phone')),
    employees: Number.isFinite(employees) ? employees : null,
    owner_id: text(formData.get('owner_id')),
    amount: money(formData.get('amount')),
    close_date: text(formData.get('close_date')),
  };

  // The form still carries one address, because "add a company" should not
  // start with a location editor. It writes the company's primary location;
  // every location after the first is added from the company page.
  const place = {
    address: text(formData.get('address')),
    city: text(formData.get('city')),
    region: text(formData.get('region')),
  };
  const hasPlace = Boolean(place.address || place.city || place.region);

  if (id) {
    const { error } = await supabase.from('companies').update(record).eq('id', id);
    if (error) return { error: error.message };

    // Update the primary in place rather than adding a second one: this form
    // edits the company's address, it does not open a new site.
    const { data: existing } = await supabase
      .from('company_locations')
      .select('id')
      .eq('company_id', id)
      .eq('is_primary', true)
      .maybeSingle();

    if (existing) {
      const { error: placeError } = await supabase
        .from('company_locations')
        .update(place)
        .eq('id', existing.id);
      if (placeError) return { error: placeError.message };
    } else if (hasPlace) {
      const { error: placeError } = await supabase
        .from('company_locations')
        .insert({ ...place, company_id: id, is_primary: true, created_by: profile.id });
      if (placeError) return { error: placeError.message };
    }

    revalidatePath(`/companies/${id}`);
  } else {
    const { data, error } = await supabase
      .from('companies')
      .insert({ ...record, created_by: profile.id })
      .select('id')
      .single();
    if (error) return { error: error.message };

    if (hasPlace) {
      const { error: placeError } = await supabase
        .from('company_locations')
        .insert({ ...place, company_id: data.id, is_primary: true, created_by: profile.id });
      if (placeError) return { error: placeError.message };
    }

    revalidatePath('/companies');
    revalidatePath('/map');
    redirect(`/companies/${data.id}`);
  }

  revalidatePath('/companies');
  revalidatePath('/map');
  return { ok: true };
}

// ------------------------------------------------------------------ locations

/** Everything a location form submits. Shared by add and edit. */
function locationFields(formData: FormData) {
  return {
    label: text(formData.get('label')),
    address: text(formData.get('address')),
    city: text(formData.get('city')),
    region: text(formData.get('region')),
    county: text(formData.get('county')),
  };
}

/** Revalidate every page a location shows up on. */
function revalidateLocations(companyId: string) {
  revalidatePath(`/companies/${companyId}`);
  revalidatePath('/companies');
  revalidatePath('/map');
}

export async function addLocation(formData: FormData) {
  const { profile, supabase } = await requireMember();

  const companyId = text(formData.get('company_id'));
  if (!companyId) return { error: 'No company given.' };

  const fields = locationFields(formData);
  if (!fields.address && !fields.city && !fields.region) {
    return { error: 'Give the location an address, a city or a region.' };
  }

  // A new location is never primary unless asked for; the database promotes it
  // anyway when it is the company's first.
  const { error } = await supabase.from('company_locations').insert({
    ...fields,
    company_id: companyId,
    is_primary: formData.get('is_primary') === 'on',
    created_by: profile.id,
  });
  if (error) return { error: error.message };

  revalidateLocations(companyId);
  return { ok: true };
}

export async function updateLocation(formData: FormData) {
  const { supabase } = await requireMember();

  const id = text(formData.get('id'));
  const companyId = text(formData.get('company_id'));
  if (!id || !companyId) return { error: 'No location given.' };

  const fields = locationFields(formData);
  if (!fields.address && !fields.city && !fields.region) {
    return { error: 'Give the location an address, a city or a region.' };
  }

  // Editing the address invalidates the point: the coordinates still describe
  // where the old address was. Clearing them puts the row back in the
  // geocoder's queue rather than leaving a pin on the wrong building.
  const { data: before } = await supabase
    .from('company_locations')
    .select('address, city')
    .eq('id', id)
    .maybeSingle();

  const moved =
    before && (before.address !== fields.address || before.city !== fields.city);

  const { error } = await supabase
    .from('company_locations')
    .update(moved ? { ...fields, latitude: null, longitude: null, geo_precision: null, area: null } : fields)
    .eq('id', id);
  if (error) return { error: error.message };

  revalidateLocations(companyId);
  return { ok: true };
}

export async function deleteLocation(formData: FormData) {
  const { supabase } = await requireMember();

  const id = text(formData.get('id'));
  const companyId = text(formData.get('company_id'));
  if (!id || !companyId) return { error: 'No location given.' };

  // Deleting the primary promotes the next one — the database does that, so
  // there is no "which one is primary now" decision to make here.
  const { error } = await supabase.from('company_locations').delete().eq('id', id);
  if (error) return { error: error.message };

  revalidateLocations(companyId);
  return { ok: true };
}

export async function setPrimaryLocation(formData: FormData) {
  const { supabase } = await requireMember();

  const id = text(formData.get('id'));
  const companyId = text(formData.get('company_id'));
  if (!id || !companyId) return { error: 'No location given.' };

  // Demoting the previous primary is the trigger's job; setting this one is
  // the whole statement.
  const { error } = await supabase
    .from('company_locations')
    .update({ is_primary: true })
    .eq('id', id);
  if (error) return { error: error.message };

  revalidateLocations(companyId);
  return { ok: true };
}

export async function setCompanyStatus(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  // Nothing gates a status change any more (016 dropped the committed gate),
  // but the database can still say no — a role change mid-session, say — and
  // surfacing that beats a silent no-op, which is what an ignored error would
  // look like from the dropdown.
  const { error } = await supabase
    .from('companies')
    .update({ status: oneOf(formData.get('status'), STATUSES, 'prospect') })
    .eq('id', id);

  revalidatePath('/companies');
  revalidatePath(`/companies/${id}`);
  revalidatePath('/pipeline');

  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Archive, or bring back. Not a delete: the row, its history and its contacts
 * stay exactly where they were, and it is reversible from the same control.
 */
export async function setCompanyArchived(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  const archived = formData.get('archived') === 'true';

  await supabase
    .from('companies')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id);

  revalidatePath('/companies');
  revalidatePath(`/companies/${id}`);
  revalidatePath('/pipeline');
  revalidatePath('/map');
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

  const fields = ['company_id', 'last_name', 'email', 'phone', 'title', 'notes', 'division'] as const;

  if (id) {
    // An edit updates only what the form actually submitted. A form that shows
    // four fields must not blank the three it does not: sending the whole record
    // would mean editing somebody's job title silently cleared their division,
    // their notes, and — worst — the company they belong to.
    const patch: Record<string, string | null> = { first_name };
    for (const field of fields) {
      if (formData.has(field)) patch[field] = text(formData.get(field));
    }

    const { error } = await supabase.from('contacts').update(patch).eq('id', id);
    if (error) return { error: error.message };

    revalidatePath('/contacts');
    // The company is not necessarily in the form, so it is read back rather
    // than assumed — otherwise editing from the company page fails to refresh it.
    const { data: row } = await supabase
      .from('contacts')
      .select('company_id')
      .eq('id', id)
      .maybeSingle();
    if (row?.company_id) revalidatePath(`/companies/${row.company_id}`);
    return { ok: true };
  }

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

  const { error } = await supabase
    .from('contacts')
    .insert({ ...record, created_by: profile.id });

  if (error) return { error: error.message };

  revalidatePath('/contacts');
  if (record.company_id) revalidatePath(`/companies/${record.company_id}`);
  return { ok: true };
}

/**
 * Attach an existing unlinked contact to this company.
 *
 * A CSV of contacts whose `company` column matches nothing imports them with no
 * company — the importer says so and carries on, which is right, but until now
 * there was no way to put them where they belong short of editing the row.
 *
 * Only contacts that have NO company can be attached, and that is enforced in
 * the statement rather than checked first: `is('company_id', null)` means two
 * members doing this at once cannot quietly move somebody off another company's
 * page. A zero-row update is that race, not a missing contact.
 */
export async function attachContact(formData: FormData) {
  const { supabase } = await requireMember();

  const contactId = text(formData.get('contact_id'));
  const companyId = text(formData.get('company_id'));
  if (!contactId || !companyId) return { error: 'Pick a contact to add.' };

  const { data, error } = await supabase
    .from('contacts')
    .update({ company_id: companyId })
    .eq('id', contactId)
    .is('company_id', null)
    .select('id');

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'That contact already belongs to a company. Reload the page.' };
  }

  revalidatePath('/contacts');
  revalidatePath(`/companies/${companyId}`);
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

/**
 * Log what happened and, when the composer's follow-up is filled in, the thing
 * that happens next — in one submit.
 *
 * The gap between "I talked to them" and "somebody owes them something" is
 * where outreach dies. As two deliberate acts the second one often did not
 * happen; as one form it usually does.
 */
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

  // The follow-up is optional and deliberately forgiving: a title with no date
  // is still a task worth having, and a date with no title is not a task at all.
  const followUp = text(formData.get('follow_up'));
  if (followUp) {
    const { error: taskError } = await supabase.from('tasks').insert({
      title: followUp,
      due_date: text(formData.get('follow_up_due')),
      company_id,
      contact_id: text(formData.get('contact_id')),
      assignee_id: profile.id,
      created_by: profile.id,
    });

    // The activity is already saved, so a failure here must not read as though
    // nothing was logged.
    if (taskError) {
      if (company_id) revalidatePath(`/companies/${company_id}`);
      return { ok: true, warning: `Logged, but the follow-up did not save: ${taskError.message}` };
    }
    revalidatePath('/tasks');
  }

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
  if (op === 'archive') return bulkArchive(formData, true);
  if (op === 'restore') return bulkArchive(formData, false);
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

/**
 * Archive or restore a selection. The bulk version matters more than the single
 * one: archiving is what somebody does to eighty rows at the end of a season.
 */
export async function bulkArchive(formData: FormData, archived: boolean) {
  const { supabase } = await requireMember();
  const list = ids(formData);
  if (list.length === 0) return;

  await supabase
    .from('companies')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .in('id', list);

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

// ------------------------------------------------------ settings & templates

/**
 * The club's own details, merged into every outgoing draft.
 *
 * Admin-only, and RLS says so too. These four fields appear in mail the whole
 * club sends, so they are not something one member should be able to change on
 * everyone else's behalf without being trusted with the rest of the settings.
 */
export async function saveClubDetails(formData: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: 'Only admins can change club settings.' };

  // Rejected here, not coerced: an admin who typed "America/Atlanta" should be
  // told, not silently put on UTC by the read-side fallback.
  const timeZone = text(formData.get('timeZone')) ?? DEFAULT_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) {
    return { error: `"${timeZone}" is not a time zone this server knows. Use an IANA name like America/New_York.` };
  }

  // Merged over what is already there rather than replacing the row: the same
  // `club` row carries `contactEmail` for the public privacy and terms pages,
  // and a save from this form must not wipe a field this form does not show.
  const { data: existing } = await ctx.supabase
    .from('settings')
    .select('value')
    .eq('key', 'club')
    .maybeSingle();

  const value = {
    ...((existing?.value ?? {}) as Record<string, unknown>),
    clubName: text(formData.get('clubName')) ?? '',
    school: text(formData.get('school')) ?? '',
    groupSize: text(formData.get('groupSize')) ?? '',
    visitLength: text(formData.get('visitLength')) ?? '',
    timeZone,
  };

  const { error } = await ctx.supabase
    .from('settings')
    .upsert({ key: 'club', value, updated_by: ctx.profile.id, updated_at: new Date().toISOString() },
            { onConflict: 'key' });

  if (error) return { error: error.message };

  revalidatePath('/settings');
  revalidatePath('/companies');
  // "Today" moved, so everything that reckons it has to be re-read.
  revalidatePath('/');
  revalidatePath('/tasks');
  return { ok: true };
}

/**
 * The club's outreach goal: how much contact it means to make daily, monthly
 * and yearly. Any of the three can be left blank, which is how a club that only
 * thinks in months ends up seeing only a monthly bar.
 *
 * Admin-only, like the other club-wide settings — a target everyone is measured
 * against is not something one member should set for the rest.
 */
export async function saveOutreachGoal(formData: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: 'Only admins can set the club goal.' };

  const number = (name: string) => {
    const n = Number.parseInt(text(formData.get(name)) ?? '', 10);
    // Zero and negatives are not goals, they are a blank field said differently.
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const value = {
    metric: formData.get('metric') === 'contacted' ? 'contacted' : 'outreach',
    daily: number('daily'),
    monthly: number('monthly'),
    yearly: number('yearly'),
  };

  const { error } = await ctx.supabase
    .from('settings')
    .upsert({ key: 'goal', value, updated_by: ctx.profile.id, updated_at: new Date().toISOString() },
            { onConflict: 'key' });

  if (error) return { error: error.message };

  revalidatePath('/settings');
  revalidatePath('/');
  return { ok: true };
}

/** Create or update one email template. Any member may improve a letter. */
export async function saveTemplate(formData: FormData) {
  const { profile, supabase } = await requireMember();

  const id = text(formData.get('id'));
  const name = text(formData.get('name'));
  const body = text(formData.get('body'));
  if (!name) return { error: 'Give the template a name.' };
  if (!body) return { error: 'A template with no body has nothing to send.' };

  const sort = Number.parseInt(text(formData.get('sort')) ?? '', 10);
  const suggest = text(formData.get('suggest_for'));

  const record = {
    name,
    guidance: text(formData.get('guidance')),
    subject: text(formData.get('subject')) ?? name,
    body,
    sort: Number.isFinite(sort) ? sort : 100,
    suggest_for: suggest && STATUSES.includes(suggest as never) ? suggest : null,
  };

  const { error } = id
    ? await supabase.from('email_templates').update(record).eq('id', id)
    : await supabase.from('email_templates').insert({
        ...record,
        slug: slugify(name),
        created_by: profile.id,
        updated_by: profile.id,
      });

  if (error) {
    return {
      error:
        error.code === '23505'
          ? 'A template with that name already exists.'
          : error.message,
    };
  }

  revalidatePath('/settings');
  return { ok: true };
}

export async function deleteTemplate(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  if (!id) return;

  // RLS narrows this to admins and the template's author, and refuses by
  // matching no rows — so check what actually went rather than assuming.
  const { data, error } = await supabase.from('email_templates').delete().eq('id', id).select('id');
  if (error) throw new Error(`Could not delete template: ${error.message}`);
  if ((data?.length ?? 0) === 0) {
    throw new Error('Only an admin, or whoever wrote it, can delete a template.');
  }

  revalidatePath('/settings');
}

/**
 * Replace the templates from a Markdown file.
 *
 * Matching is by slug: a template in the file that already exists is updated,
 * one that does not is created, and anything not mentioned is left alone. That
 * last part is deliberate — an import is how somebody shares two new letters,
 * not usually how they wipe the club's set, and deleting by omission would make
 * a truncated paste destructive.
 */
export async function importTemplates(formData: FormData) {
  const { profile, supabase } = await requireMember();

  const markdown = text(formData.get('markdown'));
  if (!markdown) return { error: 'Paste the Markdown first, or choose a file.' };

  const { templates, errors } = templatesFromMarkdown(markdown);
  if (templates.length === 0) {
    return { error: errors[0] ?? 'Nothing in that file looked like a template.' };
  }

  const { error } = await supabase.from('email_templates').upsert(
    templates.map((t) => ({ ...t, created_by: profile.id, updated_by: profile.id })),
    { onConflict: 'slug' },
  );

  if (error) return { error: error.message };

  revalidatePath('/settings');
  return {
    ok: true,
    imported: templates.length,
    warnings: errors,
  };
}

// ------------------------------------------------------------- attachments

/**
 * Record a file that the browser has already uploaded to Storage.
 *
 * The upload itself goes straight from the browser to Supabase Storage — see
 * components/attachments.tsx — so a 10 MB agreement never passes through a
 * Vercel request body or its size limit. This only writes the index row.
 */
export async function recordAttachment(formData: FormData) {
  const { profile, supabase } = await requireMember();

  const company_id = text(formData.get('company_id'));
  const path = text(formData.get('path'));
  const name = text(formData.get('name'));
  if (!company_id || !path || !name) return { error: 'Nothing to record.' };

  const size = Number.parseInt(text(formData.get('size_bytes')) ?? '', 10);

  const { error } = await supabase.from('attachments').insert({
    company_id,
    name,
    path,
    mime: text(formData.get('mime')),
    size_bytes: Number.isFinite(size) ? size : null,
    created_by: profile.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/companies/${company_id}`);
  return { ok: true };
}

/**
 * Remove a file: the object first, then the row.
 *
 * That order is deliberate. A row with no object behind it is a broken download
 * link somebody will report; an object with no row is invisible and bills the
 * club's 1 GB quota forever.
 */
export async function deleteAttachment(formData: FormData) {
  const { supabase } = await requireMember();
  const id = text(formData.get('id'));
  const company_id = text(formData.get('company_id'));
  if (!id) return;

  const { data: row } = await supabase
    .from('attachments')
    .select('path')
    .eq('id', id)
    .maybeSingle();

  if (row?.path) {
    const { error } = await supabase.storage.from('attachments').remove([row.path as string]);
    if (error) return { error: `Could not remove the file: ${error.message}` };
  }

  const { error } = await supabase.from('attachments').delete().eq('id', id);
  if (error) return { error: error.message };

  if (company_id) revalidatePath(`/companies/${company_id}`);
  return { ok: true };
}

/**
 * A short-lived link to one file.
 *
 * The bucket is private, so a path is not enough to read anything: this mints a
 * signed URL for the member asking, valid for a minute — long enough to click,
 * short enough that a copied link in a group chat is useless by the time
 * anybody else opens it.
 */
export async function attachmentUrl(path: string) {
  const { supabase } = await requireProfile();

  const { data, error } = await supabase.storage.from('attachments').createSignedUrl(path, 60);
  if (error || !data) return { error: error?.message ?? 'Could not open that file.' };

  return { url: data.signedUrl };
}

// -------------------------------------------------------------- the season

/**
 * Move one member's companies and open tasks to another.
 *
 * Goes through reassign_member(), which re-checks admin in the database,
 * because it rewrites other people's assignments. Surfaced next to Remove on
 * the members list: removing somebody without moving their work is the mistake
 * it exists to prevent.
 */
export async function reassignMember(formData: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: 'Only admins can reassign work.' };

  const from_member = text(formData.get('from_member'));
  const to_member = text(formData.get('to_member'));
  if (!from_member) return { error: 'Pick who is leaving.' };

  const { data, error } = await ctx.supabase.rpc('reassign_member', {
    from_member,
    to_member,
  });

  if (error) return { error: error.message };

  revalidatePath('/settings');
  revalidatePath('/companies');
  revalidatePath('/tasks');

  const moved = (data ?? {}) as { companies?: number; tasks?: number };
  return { ok: true, companies: moved.companies ?? 0, tasks: moved.tasks ?? 0 };
}

/** How long each stage may sit untouched. Admin-only, like the other club rules. */
export async function saveRottingRules(formData: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: 'Only admins can change the going-cold rules.' };

  const value: Record<string, number> = {};
  for (const status of STATUSES) {
    const n = Number.parseInt(text(formData.get(status)) ?? '', 10);
    if (Number.isFinite(n) && n > 0) value[status] = n;
  }

  const { error } = await ctx.supabase
    .from('settings')
    .upsert({ key: 'rotting', value, updated_by: ctx.profile.id, updated_at: new Date().toISOString() },
            { onConflict: 'key' });

  if (error) return { error: error.message };

  revalidatePath('/settings');
  revalidatePath('/');
  revalidatePath('/companies');
  return { ok: true };
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
