import { contactName, type Company, type Contact, type Interest } from '@/lib/types';

/**
 * Cold-email drafting.
 *
 * Templates with merge fields, not a language model. Three reasons, in order of
 * how much they matter:
 *
 *   1. A club's first email to a factory is a small, formal genre. It has to say
 *      who we are, what we want, how long it takes and what we are not asking
 *      for. A template says that reliably; a model paraphrases it differently
 *      every time and occasionally invents a detail.
 *   2. Nobody can send a promise the club cannot keep — "twenty students, two
 *      hours, a Thursday" is in the template where a human wrote it and another
 *      human can edit it.
 *   3. No API key, no per-send cost, works offline, and the output is the same
 *      today as it was last term.
 *
 * Every draft is a starting point. The composer shows it, the member edits it,
 * and their mail client sends it — this file never touches the network.
 */

export type DraftInput = {
  company: Pick<Company, 'name' | 'type' | 'city' | 'industry' | 'interest' | 'tier' | 'status'>;
  contact?: Pick<Contact, 'first_name' | 'last_name' | 'title' | 'email'> | null;
  /** The club member writing, for the sign-off. */
  sender: { name: string; email: string };
  club: ClubDetails;
};

/**
 * The bits that are the same in every email and different for every club. These
 * default to visibly-blank placeholders rather than to invented specifics: a
 * draft that says [YOUR CLUB] is obviously unfinished, whereas one that says
 * "the Engineering Society" is wrong in a way somebody will send by accident.
 */
export type ClubDetails = {
  clubName: string;
  school: string;
  groupSize: string;
  visitLength: string;
};

export const CLUB_DEFAULTS: ClubDetails = {
  clubName: '[YOUR CLUB]',
  school: '[YOUR SCHOOL]',
  groupSize: '[GROUP SIZE]',
  visitLength: '[LENGTH]',
};

export type TemplateId = 'tour' | 'sponsorship' | 'nudge' | 'reintro';

export type Template = {
  id: TemplateId;
  name: string;
  /** When to reach for it, shown under the picker. */
  when: string;
};

export const TEMPLATES: Template[] = [
  { id: 'tour', name: 'Ask for a tour', when: 'First approach, when you want to visit.' },
  { id: 'sponsorship', name: 'Ask for sponsorship', when: 'First approach, when you want support.' },
  { id: 'nudge', name: 'Nudge after silence', when: 'You wrote, nobody replied, it has been a fortnight.' },
  { id: 'reintro', name: 'New year, new committee', when: 'They hosted before, and the committee has changed.' },
];

export type Draft = { subject: string; body: string };

/**
 * "Hi Priya," when we know what to call them, "Hello," otherwise. An imported
 * row can carry an email address and nothing else, and "Hi undefined," is worse
 * than no name at all — it is the one mistake that tells the reader a machine
 * wrote this and nobody checked.
 */
const salutation = (c: DraftInput['contact']) => {
  const first = c?.first_name?.trim();
  return first ? `Hi ${first},` : 'Hello,';
};

/** "your Halifax site", or "your site" when we never recorded a city. */
const site = (city: string | null) => (city ? `your ${city} site` : 'your site');

/**
 * What we think they are, in words a stranger would use about themselves.
 * `type` is the club's own word for the record ("Factory", "Museum"), which is
 * fine to say back to them; `industry` is more specific when we have it.
 */
const described = (company: DraftInput['company']) => {
  const what = company.industry ?? company.type;
  return what ? what.toLowerCase() : 'what you do';
};

const wants = (interest: Interest[] | null): 'tour' | 'sponsorship' | 'both' => {
  const list = interest ?? [];
  const tour = list.includes('tour');
  const sponsor = list.includes('sponsorship');
  if (tour && sponsor) return 'both';
  if (sponsor) return 'sponsorship';
  return 'tour';
};

/** The template that fits what we recorded wanting from this company. */
export function suggestedTemplate(company: DraftInput['company']): TemplateId {
  if (company.status === 'contacted') return 'nudge';
  if (company.status === 'dormant' || company.status === 'declined') return 'reintro';
  return wants(company.interest) === 'sponsorship' ? 'sponsorship' : 'tour';
}

export function draftEmail(template: TemplateId, input: DraftInput): Draft {
  const { company, contact, sender, club } = input;
  const hi = salutation(contact);
  const sign = `${sender.name}\n${club.clubName}, ${club.school}\n${sender.email}`;

  if (template === 'sponsorship') {
    return {
      subject: `${club.clubName} at ${club.school} — supporting ${club.groupSize} students`,
      body: `${hi}

I am ${sender.name}, writing on behalf of ${club.clubName} at ${club.school}. We are a student group of about ${club.groupSize}, and we spend the year visiting employers and running events for members who are about to enter the industry.

We are looking for organisations to support that programme. Support can be a contribution towards travel and materials, or something in kind — hosting an event, sending a speaker, covering a coach. We are glad to acknowledge supporters on our materials and at our events, and we are equally glad not to if you would rather stay quiet about it.

I am contacting ${company.name} because of your work in ${described(company)}${company.city ? `, and because you are close enough to us that our members can actually get there` : ''}.

Could I send you a short outline of what we do and what support would mean this year?

Thank you for reading,
${sign}`,
    };
  }

  if (template === 'nudge') {
    return {
      subject: `Following up: visiting ${company.name}`,
      body: `${hi}

I wrote a couple of weeks ago about bringing a group of students from ${club.clubName} at ${club.school} to ${site(company.city)}, and I know a message like mine is easy to lose.

If a visit is not something you can host, please just say so and I will stop writing — no hard feelings at all, and it is genuinely useful to know.

If it is a matter of timing, we are flexible: any term-time month works, and we can fit around a quiet week in your calendar.

Thanks either way,
${sign}`,
    };
  }

  if (template === 'reintro') {
    return {
      subject: `${club.clubName} — new committee, saying hello again`,
      body: `${hi}

${company.name} has worked with ${club.clubName} at ${club.school} before, and I wanted to reintroduce us: the committee changes every year, and I am this year's.

We are planning our visits for the coming year, and yours is on the list of places our members ask about. If you are still open to hosting a group of around ${club.groupSize} for ${club.visitLength}, I would love to find a date. If circumstances have changed, that is completely understood — just let me know and I will take you off our list.

Best wishes,
${sign}`,
    };
  }

  const both = wants(company.interest) === 'both';

  return {
    subject: `Student visit to ${company.name}?`,
    body: `${hi}

I am ${sender.name}, from ${club.clubName} at ${club.school}. We take small groups of students to see how things are actually made and run, because a morning on a real site teaches more than a term of slides.

I am writing to ask whether ${company.name} would consider hosting us at ${site(company.city)}. We are interested in your work in ${described(company)}${contact?.title ? `, and you seemed like the right person to ask given your role as ${contact.title}` : ''}.

What we would ask for:

- About ${club.groupSize} students, plus one member of staff
- Roughly ${club.visitLength}, on a weekday that suits you
- Any date in term time — we work around your calendar, not the other way round

What we bring: students who have been briefed on site rules, sensible shoes, and questions prepared in advance. We are happy to sign whatever visitor agreement or NDA you use, and to keep phones away entirely if you would prefer.${
      both
        ? `\n\nIf a visit is not practical, we would also welcome a conversation about supporting the club in other ways.`
        : ''
    }

Would you be open to it? I am glad to answer any questions first.

Thank you for your time,
${sign}`,
  };
}

/** A `mailto:` link the member's own mail client opens, prefilled. */
export function mailtoLink(to: string | null | undefined, draft: Draft) {
  const params = new URLSearchParams({ subject: draft.subject, body: draft.body });
  return `mailto:${to ?? ''}?${params.toString().replace(/\+/g, '%20')}`;
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
