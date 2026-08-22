/**
 * The guide's changelog.
 *
 * KEEPING THIS CURRENT IS PART OF SHIPPING. When you add or change a feature,
 * add an entry here in the same commit — the guide at /guide renders this
 * directly, so an out-of-date entry is an out-of-date user manual.
 *
 * Newest first.
 */

export type Change = {
  date: string; // ISO date
  title: string;
  notes: string[];
};

export const CHANGELOG: Change[] = [
  {
    date: '2026-08-22',
    title: 'Bulk actions, member admin, and this guide',
    notes: [
      'Select companies with the checkboxes and assign them, or move their status, in one go.',
      'Members page: add and remove people, set admins, and choose your own display name — no more SQL.',
      'This guide, which updates whenever the app does.',
    ],
  },
  {
    date: '2026-08-22',
    title: 'Map shows every company',
    notes: [
      'Zoomed out you get one bubble per region; zoom in and companies separate into individual pins.',
      'Clicking a pin opens that company.',
      'Filter the map by tier and owner.',
    ],
  },
  {
    date: '2026-08-21',
    title: 'Assignment, status history, and the pipeline chart',
    notes: [
      'Companies can be assigned to a club member, and filtered by who owns them.',
      'Every status change records who made it and when; see it on the company page.',
      'New Pipeline tab: a live flowchart of where everything stands.',
    ],
  },
  {
    date: '2026-08-21',
    title: 'The Georgia directory, cleaned up',
    notes: [
      '1,263 companies loaded, de-duplicated, and placed on the map.',
      'Data centers and warehouse-automation sites added, including Amazon Stone Mountain, which runs public tours.',
      'Siemens Pendergrass added as Tier 1 — they make the PLCs.',
    ],
  },
];

/** Shown in the guide header so it's obvious how fresh the page is. */
export const LAST_UPDATED = CHANGELOG[0].date;
