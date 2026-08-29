import Link from 'next/link';
import { toggleTask, deleteTask } from '@/app/actions';

type Props = {
  task: {
    id: string;
    title: string;
    due_date: string | null;
    done: boolean;
    company_id: string | null;
    companies?: { name: string } | null;
  };
  today: string;
  showDelete?: boolean;
  /** Viewers get the same row without the tick box or the delete link. */
  readOnly?: boolean;
};

export function TaskRow({ task, today, showDelete = false, readOnly = false }: Props) {
  const overdue = !task.done && task.due_date !== null && task.due_date < today;

  return (
    <li className="flex items-center gap-3 px-5 py-3 text-sm">
      {readOnly ? (
        // Still a box, so the row keeps its shape and a ticked task still reads
        // as ticked — it just isn't a control.
        <span
          aria-label={task.done ? 'Done' : 'Not done'}
          className={`h-4 w-4 shrink-0 rounded border ${
            task.done ? 'border-black/25 bg-black/25' : 'border-black/15'
          }`}
        />
      ) : (
        <form action={toggleTask} className="flex">
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name="done" value={String(!task.done)} />
          <button
            type="submit"
            aria-label={task.done ? 'Mark as not done' : 'Mark as done'}
            className={`h-4 w-4 rounded border transition ${
              task.done ? 'border-ink bg-ink' : 'border-black/25 hover:border-ink'
            }`}
          />
        </form>
      )}

      <div className="min-w-0 flex-1">
        <div className={task.done ? 'text-black/35 line-through' : ''}>{task.title}</div>
        {task.companies && task.company_id && (
          <Link
            href={`/companies/${task.company_id}`}
            className="text-xs text-black/50 hover:text-ink"
          >
            {task.companies.name}
          </Link>
        )}
      </div>

      {task.due_date && (
        <span className={`shrink-0 text-xs ${overdue ? 'font-medium text-danger' : 'text-black/40'}`}>
          {new Date(task.due_date + 'T00:00:00').toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      )}

      {showDelete && !readOnly && (
        <form action={deleteTask}>
          <input type="hidden" name="id" value={task.id} />
          <button className="text-xs text-black/30 hover:text-danger">Delete</button>
        </form>
      )}
    </li>
  );
}
