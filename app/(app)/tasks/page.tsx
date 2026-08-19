import { serverClient } from '@/lib/supabase';
import { TaskRow } from '@/components/task-row';
import { QuickTaskForm } from '@/components/quick-task-form';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const supabase = await serverClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, due_date, done, company_id, companies(name)')
    .order('done')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(200);

  const open = (tasks ?? []).filter((t) => !t.done);
  const done = (tasks ?? []).filter((t) => t.done);

  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const upcoming = open.filter((t) => !t.due_date || t.due_date >= today);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {overdue.length > 0 && (
            <Section title={`Overdue · ${overdue.length}`}>
              {overdue.map((t) => (
                <TaskRow key={t.id} task={t as never} today={today} showDelete />
              ))}
            </Section>
          )}

          <Section title={`Open · ${upcoming.length}`} empty="Nothing outstanding.">
            {upcoming.map((t) => (
              <TaskRow key={t.id} task={t as never} today={today} showDelete />
            ))}
          </Section>

          {done.length > 0 && (
            <Section title={`Done · ${done.length}`}>
              {done.slice(0, 30).map((t) => (
                <TaskRow key={t.id} task={t as never} today={today} showDelete />
              ))}
            </Section>
          )}
        </div>

        <section className="card h-fit p-5">
          <h2 className="mb-3 text-sm font-semibold">New task</h2>
          <QuickTaskForm />
        </section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode[];
  empty?: string;
}) {
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-black/10 px-5 py-3 text-sm font-semibold">{title}</h2>
      {children.length > 0 ? (
        <ul className="divide-y divide-black/5">{children}</ul>
      ) : (
        <p className="px-5 py-6 text-sm text-black/45">{empty}</p>
      )}
    </section>
  );
}
