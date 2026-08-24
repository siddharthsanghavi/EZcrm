import { setCompanyTier } from '@/app/actions';
import { TIERS } from '@/lib/types';

/**
 * Change a company's tier from its own page.
 *
 * A plain form, like OwnerPicker — no JavaScript needed, and re-tiering is
 * occasional enough that a server round-trip is cheaper than optimistic UI.
 *
 * "Unrated" is a first-class choice rather than an accident: a company added by
 * hand starts with no tier, and being able to put one back is what makes the
 * Tier filters trustworthy.
 */
export function TierPicker({ companyId, tier }: { companyId: string; tier: string | null }) {
  return (
    <form action={setCompanyTier} className="flex items-center gap-2">
      <input type="hidden" name="id" value={companyId} />
      <select
        name="tier"
        defaultValue={tier ?? ''}
        aria-label="Tier"
        className="field w-36 py-1.5"
      >
        <option value="">Unrated</option>
        {TIERS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button className="btn-ghost py-1.5">Set tier</button>
    </form>
  );
}
