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
    date: '2026-09-06',
    title: 'A board you can drag, money in the pipeline, files, and search',
    notes: [
      'The pipeline is now a board. Drag a company between columns to change its status, with each column showing how many companies and how much money sit in it.',
      'Companies have an amount and a close date. The pipeline shows a weighted total — a prospect counts for 5%, a conversation 40%, a commitment in full — next to what is actually committed.',
      '“Committed” now means something: a company cannot be marked committed without a named contact and a date. The app says which one is missing.',
      'Press ⌘K (Ctrl-K on Windows) anywhere to search companies and contacts by name, city, industry or email. Arrow keys to move, Enter to open.',
      'Files live on the company now — signed agreements, waivers, a sponsorship deck. Up to 10 MB each, private to the club, and they stay when the person who uploaded them graduates.',
      'Archiving: take a company off the working list at the end of a season without deleting anything. Contacts, history and files stay, and it is reversible. Filter to Archived to see them, or archive a whole selection at once.',
      'Handing over: on the Members list, move somebody’s companies and open tasks to another member in one click. Do this before removing them.',
      'Logging a call now offers a follow-up task in the same form, dated a week out by default.',
      'Going cold is per stage now — set how long each stage may sit untouched under Settings. A week of silence after a first email is normal; a month mid-conversation is not.',
      'Importing a CSV checks for near-duplicates before writing anything: “Pennine Print Works, Inc.” is recognised as the company you already have. You get to decide row by row.',
      'The contacts list shows how many times each person has been contacted, and when they last were.',
    ],
  },
  {
    date: '2026-09-03',
    title: 'Set an outreach goal',
    notes: [
      'Settings → Club now has an outreach goal: how much contact the club means to make per day, per month and per year. Set any of the three and leave the rest blank — an empty box is simply not tracked.',
      'Count either every piece of outreach logged, or companies moved out of Prospect for the first time, whichever the committee actually argues about.',
      'The dashboard shows a bar for each target you set, so “nothing since Tuesday” is visible even in a month that is going well.',
      'Periods are calendar ones: the day ends at midnight and the year runs January to December, not September to June.',
    ],
  },
  {
    date: '2026-09-03',
    title: 'Settings, and the email templates are yours to edit',
    notes: [
      'New Settings page, holding the three things that belong to the club rather than to a company: your club details, your email templates, and your members. Members moved here from its own page — the old link still works.',
      'Club details — your club name, school, group size and how long a visit takes — are set once by an admin and merged into every draft. No more retyping them, and no more placeholders in outgoing mail.',
      'Email templates are now edited in the app instead of living in the code. Change the wording, add your own, set which one is suggested for a prospect versus somebody who has gone quiet. Any member can improve a letter; every edit shows up in Activity with a name against it.',
      'The editor has an insert button for each merge field — click {{company}} and it lands where your cursor is — and a live preview against a made-up company, so you see what the recipient sees before saving.',
      'Export every template to one Markdown file, edit it anywhere, and import it back. Import matches on each template’s slug: existing ones are updated, new ones added, and anything the file does not mention is left alone.',
    ],
  },
  {
    date: '2026-09-03',
    title: 'Draft the first email without staring at a blank page',
    notes: [
      'Every company page now has a Cold email panel. Pick a template — ask for a tour, ask for sponsorship, nudge after silence, or say hello again as a new committee — and it fills in the company, the contact, what you do and where they are.',
      'It picks a sensible template for you based on where the company stands: a prospect gets the first approach, one you already contacted gets the nudge, a dormant one gets the reintroduction.',
      'Open in mail app hands the draft to your own email program, so it sends from you and lands in your Sent folder. Copy does the same for anything else. The app never sends mail itself.',
      'Log as sent records it as outreach, which keeps the company off the going-cold list. Only you know whether you actually pressed send, so it is a button rather than something we assume.',
      'Set your club name, school, group size and visit length once under Club details — until you do, drafts carry visible [PLACEHOLDERS] so nothing half-finished goes out by accident.',
      'Tick several companies in the list and press Draft emails to download one draft per company as a spreadsheet, ready for a mail merge.',
    ],
  },
  {
    date: '2026-08-29',
    title: 'Contacts have a shape now',
    notes: [
      'A company’s contacts are no longer a flat list. Hover a name and press Place to say who they report to and which division they are in — the list then draws itself as a tree, grouped by division and indented by reporting line.',
      'Useful when the person who stops replying is not the person who decides. Six names in a list tell you nothing about who to ask next; six names in a tree do.',
      'Division is free text, so “Operations” or “North Plant” both work. Leave it blank and those contacts sit in a plain list underneath, exactly as before.',
      'You cannot accidentally create a loop — somebody’s own reports are never offered as their manager, and the database refuses one anyway.',
    ],
  },
  {
    date: '2026-08-27',
    title: 'Deletions are tracked, and there is a view-only role',
    notes: [
      'Deleting a company is now an admin-only act. Everyone else asks: there is a “Request deletion” box on a company’s Edit screen, and a Request deletion button in the bar at the bottom of the companies list when you tick several.',
      'Admins decide from the new Deletions page — approve, which deletes the company there and then, or decline with a reason. You can withdraw your own request while it is still waiting.',
      'Every deletion is recorded: what was deleted, by whom, who asked for it and why. The record survives the company, so “where did that go?” finally has an answer.',
      'Deleting anything now asks you to confirm first, and says what else goes with it — a company takes its contacts, activity and tasks.',
      'New Activity page: everything anyone has done, newest first — companies added or edited, statuses moved, owners assigned, contacts added, tasks finished, outreach logged, deletions decided. Filter it by kind, and see a company’s own slice under History on its page. Sign-ins are not in here; they stay under Members.',
      'The Activity page also covers membership — who was invited, who joined, whose role changed, who was removed — and every CSV import and export, including which table and how many rows. A big import shows as one line rather than four hundred.',
      'New role: a viewer sees everything and can change nothing. Useful for a treasurer, a supervising teacher, or an incoming committee member during handover. Admins pick the role when inviting someone, and can change it later on the Members page.',
    ],
  },
  {
    date: '2026-08-24',
    title: 'Sign in with Google, and editable tiers',
    notes: [
      'There is now a “Continue with Google” button on the sign-in page. It sends no email, so the club’s shared hourly limit no longer applies — and there is no link to open in the wrong browser, which was the main reason sign-ins failed.',
      'The email link still works exactly as before if you prefer it, or if Google is ever having a bad day.',
      'Signing in with Google does not grant access on its own. An admin still has to add you to the members list first.',
      'Tier is now editable straight from a company’s page, next to status and owner, instead of only inside Edit. “Unrated” is a proper option for companies nobody has assessed yet.',
      'You can re-tier many companies at once: tick them in the list and use Set tier in the bar at the bottom.',
    ],
  },
  {
    date: '2026-08-23',
    title: 'Pins move to the actual building',
    notes: [
      'Company pins used to sit on the centre of their town — often several kilometres from the real address.',
      'Admins can now press one button on Import / Export to look up street addresses and move the pins. It is free, and it refuses any result that lands somewhere implausible.',
      'City names that were spelled two ways (Atlanta / Atlanta (Fulton)) are merged, so the filters no longer split them.',
    ],
  },
  {
    date: '2026-08-22',
    title: 'The guide explains itself now',
    notes: [
      'New up-front section on what a CRM actually is, and the four kinds of record everything here is made of.',
      '“What a week looks like” — the short routine that keeps outreach from dying quietly.',
      'Worked examples with numbered callouts showing how to claim companies and log what happened.',
    ],
  },
  {
    date: '2026-08-22',
    title: 'A refreshed look',
    notes: [
      'Navigation moved to a rail down the left, with a live count beside each section — so you can see there are 12 open tasks without opening Tasks.',
      'On a phone it stays a strip across the top, so nothing is lost on a small screen.',
      'Status is now a coloured dot and a word instead of a pastel badge, which makes long lists far easier to read.',
      'The dashboard shows the pipeline as one row with a proportional bar, so you can see the shape of it rather than six equal boxes.',
      'New typeface throughout, and teal joins amber as the second accent.',
    ],
  },
  {
    date: '2026-08-22',
    title: 'Sign-in tracking',
    notes: [
      'Admins can now see sign-ins on the Members page: who got in, when, and how many attempts failed.',
      'It shows links requested against sign-ins completed — the gap is people who wanted in and didn’t get there.',
      'Failed sign-ins are grouped by cause, so it’s clear whether the “opened in a different browser” problem is worth fixing.',
      'Times show in your own timezone. The first version reported everything in UTC, so an evening sign-in appeared four hours late.',
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
