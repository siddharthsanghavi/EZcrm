import 'server-only';

import { serverClient } from '@/lib/supabase';
import type { FeedRow } from '@/components/activity-feed';

/**
 * Read the activity feed.
 *
 * `audit_events.company_id` has no foreign key — an event about a deleted
 * company has to outlive it — so PostgREST cannot embed the company, and the
 * names are fetched in a second query and stitched on here. A company that has
 * since been deleted simply comes back nameless, which is correct: the summary
 * sentence still says what happened, and there is nothing left to link to.
 */
export async function loadFeed({
  companyId,
  entity,
  limit = 60,
}: {
  companyId?: string;
  entity?: string;
  limit?: number;
} = {}): Promise<FeedRow[]> {
  const supabase = await serverClient();

  let query = supabase
    .from('audit_events')
    .select('*, profiles!audit_events_actor_fkey(full_name, email)')
    .order('at', { ascending: false })
    .limit(limit);

  if (companyId) query = query.eq('company_id', companyId);
  if (entity) query = query.eq('entity', entity);

  const { data } = await query;
  const events = (data ?? []) as FeedRow[];

  const ids = [...new Set(events.map((e) => e.company_id).filter(Boolean))] as string[];
  if (ids.length === 0) return events;

  const { data: companies } = await supabase.from('companies').select('id, name').in('id', ids);
  const byId = new Map((companies ?? []).map((c) => [c.id as string, c as { id: string; name: string }]));

  return events.map((e) => ({
    ...e,
    companies: e.company_id ? byId.get(e.company_id) ?? null : null,
  }));
}
