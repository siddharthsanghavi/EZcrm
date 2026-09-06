import Link from 'next/link';
import { ClubDetailsForm } from '@/components/club-details-form';
import { OutreachGoalForm } from '@/components/outreach-goal-form';
import { RottingRulesForm } from '@/components/season-forms';
import { MembersPanel } from '@/components/members-panel';
import { TemplateEditor } from '@/components/template-editor';
import { currentProfile } from '@/lib/supabase';
import { loadClubDetails, loadRottingRules, loadTemplates } from '@/lib/settings';
import { loadGoal } from '@/lib/goal';
import { canWrite, displayName } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TABS = [
  { id: 'club', label: 'Club' },
  { id: 'templates', label: 'Email templates' },
  { id: 'members', label: 'Members' },
] as const;

type Tab = (typeof TABS)[number]['id'];

/**
 * Everything about the club rather than about a company: who is in it, what it
 * calls itself, and the letters it sends.
 *
 * Sections rather than separate pages, because each is a handful of fields
 * somebody visits twice a term — three entries in the rail for that would be
 * three destinations nobody remembers the difference between. The tab lives in
 * the querystring so a link to one section is a real link.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active: Tab = (TABS.some((t) => t.id === tab) ? tab : 'club') as Tab;

  const me = await currentProfile();
  const isAdmin = me?.role === 'admin';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-black/55">
          The club, its people, and the letters it sends. Everything here is shared — change it and
          everyone sees the change.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/settings?tab=${t.id}`}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              active === t.id ? 'bg-ink text-white' : 'bg-black/[0.05] text-black/60 hover:bg-black/10'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {active === 'club' && <ClubSection isAdmin={isAdmin} />}

      {active === 'templates' && (
        <TemplatesSection
          me={{ name: displayName(me), email: me?.email ?? '' }}
          canEdit={canWrite(me)}
        />
      )}

      {active === 'members' && <MembersPanel />}
    </div>
  );
}

async function ClubSection({ isAdmin }: { isAdmin: boolean }) {
  const [club, goal, rotting] = await Promise.all([
    loadClubDetails(),
    loadGoal(),
    loadRottingRules(),
  ]);
  const incomplete = Object.values(club).some((v) => v.startsWith('['));

  return (
    <>
    <section className="card p-5">
      <h2 className="text-sm font-semibold">Club details</h2>
      <p className="mt-1 text-sm text-black/55">
        Merged into every email draft. Fill these in once and nobody has to retype them — until you
        do, drafts go out carrying visible placeholders.
      </p>

      {incomplete && (
        <p className="mt-2 text-sm text-warn">
          Some of these are still placeholders.
        </p>
      )}

      <ClubDetailsForm club={club} isAdmin={isAdmin} />

    </section>

    <section className="card mt-6 p-5">
      <h2 className="text-sm font-semibold">Outreach goal</h2>
      <p className="mt-1 text-sm text-black/55">
        How much contact the club means to make. Set any of the three — leave a box empty and that
        one simply is not tracked. Progress shows on the dashboard.
      </p>

      <OutreachGoalForm goal={goal} isAdmin={isAdmin} />
    </section>

    <section className="card mt-6 p-5">
      <h2 className="text-sm font-semibold">Going cold</h2>
      <p className="mt-1 text-sm text-black/55">
        How long a company may sit at each stage before the dashboard flags it. A week of silence
        after a first email is normal; a month mid-conversation is not, which is why these are per
        stage rather than one number.
      </p>

      <RottingRulesForm rules={rotting} isAdmin={isAdmin} />
    </section>
    </>
  );
}

async function TemplatesSection({
  me,
  canEdit,
}: {
  me: { name: string; email: string };
  canEdit: boolean;
}) {
  const [templates, club] = await Promise.all([loadTemplates(), loadClubDetails()]);
  return <TemplateEditor templates={templates} club={club} me={me} canEdit={canEdit} />;
}

