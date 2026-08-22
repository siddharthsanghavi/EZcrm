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
    title: 'Sign-in tracking',
    notes: [
      'Admins can now see sign-ins on the Members page: who got in, when, and how many attempts failed.',
      'It shows links requested against sign-ins completed — the gap is people who wanted in and didn’t get there.',
      'Failed sign-ins are grouped by cause, so it’s clear whether the “opened in a different browser” problem is worth fixing.',
    ],
  },
  {
    date: '2026-08-22',
    title: 'Sign-in emails: an honest limit',
    notes: [
      'The sign-in page now says how many of the hour’s link emails are left. They are shared by the whole club, not two each — that was always true, it just wasn’t visible.',
      'If they are gone, you get told when the next one frees up instead of a technical error.',
      'Admins get a chart on the Members page showing sign-in emails per hour, and which hours hit the ceiling — those are the hours somebody quietly couldn’t get in.',
    ],
  },
  {
    date: '2026-08-22',
    title: 'Dark mode',
    notes: [
      'Light, dark, or match your system — the control is in the top right, next to your email.',
      'System is the default, so the app follows your laptop and switches with it in the evening.',
      'Your choice is remembered on that device, and applies before the page draws, so there is no white flash.',
    ],
  },
  {
    date: '2026-08-22',
    title: 'Saved views',
    notes: [
      'Filter the companies list however you like, then save it under a name — it becomes a chip you can click any time.',
      'Saved views are shared with the club by default. Untick "Share" to keep one to yourself.',
      'A view is just a link, so you can copy the address and paste it to someone.',
    ],
  },
  {
    date: '2026-08-22',
    title: 'Going cold, measured properly',
    notes: [
      'Every company now tracks when someone last logged activity against it — a real touch, not just an edit.',
      'The dashboard counts everything in play that nobody has contacted in three weeks, worst first.',
      'Companies has a "Going cold" filter, and every row shows when it was last touched.',
    ],
  },
  {
    date: '2026-08-22',
    title: 'Bulk actions, member admin, and this guide',
    notes: [
      'Select companies with the checkboxes and assign them, or move their status, in one go.',
      'Members page: add and remove people, set admins, and choose your own display name.',
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
      'Companies can be assigned to a member, and filtered by who owns them.',
      'Every status change records who made it and when; see it on the company page.',
      'New Pipeline tab: a live flowchart of where everything stands.',
    ],
  },
  {
    date: '2026-08-21',
    title: 'Company directory imported',
    notes: [
      'Prospect list loaded, de-duplicated, and placed on the map.',
      'CSV import and export for getting data in and out.',
    ],
  },
];

/** Shown in the guide header so it's obvious how fresh the page is. */
export const LAST_UPDATED = CHANGELOG[0].date;
