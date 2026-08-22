import { setCompanyOwner } from '@/app/actions';
import { displayName, type Profile } from '@/lib/types';

/**
 * Assign a club member to a company. A plain form so it works without
 * JavaScript and stays a server round-trip — assignment is rare enough that
 * optimistic UI would be more machinery than it's worth.
 */
export function OwnerPicker({
  companyId,
  ownerId,
  members,
}: {
  companyId: string;
  ownerId: string | null;
  members: Pick<Profile, 'id' | 'full_name' | 'email'>[];
}) {
  return (
    <form action={setCompanyOwner} className="flex items-center gap-2">
      <input type="hidden" name="id" value={companyId} />
      <select
        name="owner_id"
        defaultValue={ownerId ?? ''}
        aria-label="Assigned to"
        className="field w-44 py-1.5"
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {displayName(m)}
          </option>
        ))}
      </select>
      <button className="btn-ghost py-1.5">Assign</button>
    </form>
  );
}
