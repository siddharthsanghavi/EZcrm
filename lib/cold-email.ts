import { DEFAULT_TIME_ZONE, contactName, type Company, type Contact, type Interest } from '@/lib/types';

/**
 * Cold-email drafting.
 *
 * Templates are rows now, not code: the committee edits them on /settings
 * without a developer, and everyone sends the same letter. This file is what
 * turns one of those rows into a draft — the merge fields, the fallbacks when
 * the CRM does not know something, and the Markdown the templates import and
 * export as.
 *
 * Still not a language model. A club's first letter to a factory is a small
 * formal genre that has to promise only what the club can deliver; a template
 * says that the same way every time, needs no API key, and reads the same in
 * March as it did in October. What a model would add — variety — is the one
 * thing this genre does not want.
 *
 * Nothing here sends mail. The draft goes to the member's own client.
 */

export type EmailTemplate = {
  id: string;
  slug: string;
  name: string;
  guidance: string | null;
  subject: string;
  body: string;
  sort: number;
  /** Offered first for companies at this status. */
  suggest_for: string | null;
};

export type ClubDetails = {
  clubName: string;
  school: string;
  groupSize: string;
  visitLength: string;
  /** IANA zone the club's "today" is reckoned in. See `todayIn` in lib/types. */
  timeZone: string;
};

export const CLUB_DEFAULTS: ClubDetails = {
  clubName: '[YOUR CLUB]',
  school: '[YOUR SCHOOL]',
  groupSize: '[GROUP SIZE]',
  visitLength: '[LENGTH]',
  timeZone: DEFAULT_TIME_ZONE,
};

export type DraftInput = {
  // `city` is not a company column any more — it comes from the company's
  // primary location, and the caller passes it in. The letter says "your Rome
  // site", so the one place the company is filed under is the right one.
  company: Pick<Company, 'name' | 'type' | 'industry' | 'interest' | 'tier' | 'status'> & {
    city: string | null;
  };
  contact?: Pick<Contact, 'first_name' | 'last_name' | 'title' | 'email'> | null;
  /** The club member writing, for the sign-off. */
  sender: { name: string; email: string };
  club: ClubDetails;
};

export type Draft = { subject: string; body: string };

/**
 * Every merge field, with what it means and what it falls back to. This list is
 * the contract between the editor and the drafter: the editor offers exactly
 * these, and anything else a member types is left alone rather than blanked, so
 * a stray brace in a letter survives instead of eating the sentence after it.
 */
export const MERGE_FIELDS: { field: string; means: string }[] = [
  { field: 'greeting', means: '"Hi Priya," — or "Hello," when we have no name' },
  { field: 'first_name', means: "The contact's first name, blank if unknown" },
  { field: 'contact_name', means: 'Their full name' },
  { field: 'contact_title', means: 'Their job title' },
  { field: 'company', means: "The company's name" },
  { field: 'site', means: '"your York site" — or "your site" with no city' },
  { field: 'city', means: 'The city on the record' },
  { field: 'what_they_do', means: 'Their industry, or the record type' },
  { field: 'club', means: 'Your club name, from settings' },
  { field: 'school', means: 'Your school, from settings' },
  { field: 'group_size', means: 'How many students, from settings' },
  { field: 'visit_length', means: 'How long a visit takes, from settings' },
  { field: 'my_name', means: 'Your name' },
  { field: 'my_email', means: 'Your email address' },
  { field: 'signature', means: 'Your name, club, school and email, over four lines' },
];

const wants = (interest: Interest[] | null): 'tour' | 'sponsorship' | 'both' => {
  const list = interest ?? [];
  const tour = list.includes('tour');
  const sponsor = list.includes('sponsorship');
  if (tour && sponsor) return 'both';
  if (sponsor) return 'sponsorship';
  return 'tour';
};

/** The values every {{field}} resolves to for one company and contact. */
export function mergeValues(input: DraftInput): Record<string, string> {
  const { company, contact, sender, club } = input;
  const first = contact?.first_name?.trim() ?? '';

  return {
    // "Hi undefined," is the mistake that tells a reader nobody checked this,
    // so an unnamed contact gets a plain hello rather than a blank.
    greeting: first ? `Hi ${first},` : 'Hello,',
    first_name: first,
    contact_name: contact ? contactName(contact as never) : '',
    contact_title: contact?.title ?? '',
    company: company.name,
    site: company.city ? `your ${company.city} site` : 'your site',
    city: company.city ?? '',
    what_they_do: (company.industry ?? company.type ?? 'what you do').toLowerCase(),
    club: club.clubName,
    school: club.school,
    group_size: club.groupSize,
    visit_length: club.visitLength,
    my_name: sender.name,
    my_email: sender.email,
    signature: `${sender.name}\n${club.clubName}, ${club.school}\n${sender.email}`,
  };
}

/** Substitute {{fields}}. Unknown ones are left as they were written. */
export function render(text: string, values: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name: string) => {
    const value = values[name.toLowerCase()];
    return value === undefined ? whole : value;
  });
}

export function draftEmail(template: EmailTemplate, input: DraftInput): Draft {
  const values = mergeValues(input);
  return {
    subject: render(template.subject, values).trim(),
    body: render(template.body, values),
  };
}

/** Which template to offer first, from where the company stands. */
export function suggestTemplate(
  templates: EmailTemplate[],
  company: DraftInput['company'],
): EmailTemplate | undefined {
  const byStatus = templates.find((t) => t.suggest_for === company.status);
  if (byStatus) return byStatus;

  const preferred = wants(company.interest) === 'sponsorship' ? 'sponsorship' : 'tour';
  return templates.find((t) => t.slug === preferred) ?? templates[0];
}

/** A `mailto:` link the member's own mail client opens, prefilled. */
export function mailtoLink(to: string | null | undefined, draft: Draft) {
  const params = new URLSearchParams({ subject: draft.subject, body: draft.body });
  return `mailto:${to ?? ''}?${params.toString().replace(/\+/g, '%20')}`;
}

// --------------------------------------------------------------- markdown

/**
 * Templates as Markdown, so they can be edited in a real editor, reviewed in a
 * pull request, or mailed to next year's committee.
 *
 * The format is deliberately dull: a `##` heading per template, a short
 * definition list of its metadata, then the subject and body under their own
 * headings. It round-trips — export, edit, import, and what you get back is
 * what you sent — and a human reading it without ever seeing this parser can
 * still tell what a template is.
 */
export function templatesToMarkdown(templates: EmailTemplate[]): string {
  const out: string[] = [
    '# Email templates',
    '',
    'Exported from EZcrm. Edit and import this file back to update them.',
    'Merge fields look like {{company}} — see the list at the bottom.',
    '',
  ];

  for (const t of [...templates].sort((a, b) => a.sort - b.sort)) {
    out.push(`## ${t.name}`, '');
    out.push(`- slug: ${t.slug}`);
    out.push(`- sort: ${t.sort}`);
    out.push(`- suggest for: ${t.suggest_for ?? 'none'}`);
    out.push(`- when to use: ${t.guidance ?? ''}`);
    out.push('', '### Subject', '', t.subject, '', '### Body', '', t.body, '');
  }

  out.push('---', '', '## Merge fields', '');
  for (const f of MERGE_FIELDS) out.push(`- \`{{${f.field}}}\` — ${f.means}`);
  out.push('');

  return out.join('\n');
}

export type ParsedTemplate = Omit<EmailTemplate, 'id'> & { id?: string };

/**
 * Read back what `templatesToMarkdown` wrote.
 *
 * Forgiving about what a person might change by hand — heading case, missing
 * metadata, extra blank lines — and strict about the two things it cannot
 * guess: a template needs a name and a body. The trailing "Merge fields"
 * section is documentation, so it is skipped rather than imported as a
 * template called "Merge fields".
 */
export function templatesFromMarkdown(md: string): { templates: ParsedTemplate[]; errors: string[] } {
  const errors: string[] = [];
  const templates: ParsedTemplate[] = [];

  // Split on "## " headings, keeping each heading with its section.
  const sections = md.split(/^##\s+/m).slice(1);

  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    const name = lines[0].trim();
    if (!name || /^merge fields$/i.test(name)) continue;

    const rest = lines.slice(1);

    const meta = (key: string) => {
      const line = rest.find((l) => new RegExp(`^\\s*[-*]\\s*${key}\\s*:`, 'i').test(l));
      return line ? line.slice(line.indexOf(':') + 1).trim() : '';
    };

    /**
     * Everything under a "### Heading" until the next heading or a horizontal
     * rule. Walked line by line rather than matched with one regex: a lazy
     * quantifier terminated by `$` under the `m` flag stops at the first line
     * break, which silently produced empty bodies and skipped every template.
     */
    const part = (heading: string) => {
      const start = rest.findIndex((l) => new RegExp(`^###\\s+${heading}\\s*$`, 'i').test(l));
      if (start === -1) return '';

      const out: string[] = [];
      for (const line of rest.slice(start + 1)) {
        if (/^###\s/.test(line) || /^---\s*$/.test(line)) break;
        out.push(line);
      }

      return out.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    };

    const body = part('Body');
    if (!body) {
      errors.push(`"${name}" has no ### Body section, so it was skipped.`);
      continue;
    }

    const suggest = meta('suggest for').toLowerCase();
    const sort = Number.parseInt(meta('sort'), 10);

    templates.push({
      slug: meta('slug') || slugify(name),
      name,
      guidance: meta('when to use') || null,
      subject: part('Subject') || name,
      body,
      sort: Number.isFinite(sort) ? sort : 100,
      suggest_for: !suggest || suggest === 'none' ? null : suggest,
    });
  }

  if (templates.length === 0 && errors.length === 0) {
    errors.push('No templates found. Each one needs a "## Name" heading and a "### Body" section.');
  }

  return { templates, errors };
}

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'template'
  );
}

/**
 * One row per draft, for a mail merge. Columns are named for what a mail-merge
 * tool expects to find, not for what this app calls them.
 */
export function draftsToCsv(
  rows: { company: string; to: string | null; name: string | null; draft: Draft }[],
) {
  const escape = (v: string) => {
    // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const header = ['company', 'email', 'contact', 'subject', 'body'];
  const lines = rows.map((r) =>
    [r.company, r.to ?? '', r.name ?? '', r.draft.subject, r.draft.body].map(escape).join(','),
  );

  return [header.join(','), ...lines].join('\r\n');
}

export { contactName };
