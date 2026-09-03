# Email templates

The format `/settings → Email templates → Export` writes and `Import` reads.
This file is an example: the shape, with square-bracket prompts where your own
writing goes. Your club's real letters live in your database, not here — export
them from the app if you want a copy to keep.

Import matches on `slug`. A template already in the database is updated, one
that is not is created, and anything this file does not mention is left alone.

## Ask for a tour

- slug: tour
- sort: 10
- suggest for: prospect
- when to use: First approach, when you want to visit.

### Subject

Student visit to {{company}}?

### Body

{{greeting}}

I am {{my_name}}, from {{club}} at {{school}}. [Say in a sentence who you are and why a visit is worth their morning.]

I am writing to ask whether {{company}} would consider hosting us at {{site}}. We are interested in your work in {{what_they_do}}.

What we would ask for:

- About {{group_size}} students, plus one member of staff
- Roughly {{visit_length}}, on a weekday that suits you
- [Anything else you need]

[What you bring: briefed students, whatever agreement you will sign, how you handle photographs.]

Would you be open to it?

Thank you for your time,
{{signature}}

## Ask for sponsorship

- slug: sponsorship
- sort: 20
- suggest for: none
- when to use: First approach, when you want support.

### Subject

{{club}} at {{school}} — supporting {{group_size}} students

### Body

{{greeting}}

I am {{my_name}}, writing on behalf of {{club}} at {{school}}. We are a student group of about {{group_size}}.

[What the money or the help would pay for, and what a supporter gets in return.]

I am contacting {{company}} because of your work in {{what_they_do}}.

[Your ask, in one sentence.]

Thank you for reading,
{{signature}}

## Nudge after silence

- slug: nudge
- sort: 30
- suggest for: contacted
- when to use: You wrote, nobody replied, it has been a fortnight.

### Subject

Following up: visiting {{company}}

### Body

{{greeting}}

I wrote a couple of weeks ago about bringing a group of students from {{club}} at {{school}} to {{site}}, and I know a message like mine is easy to lose.

[Make it easy to say no — that is what gets you an answer.]

Thanks either way,
{{signature}}

## New year, new committee

- slug: reintro
- sort: 40
- suggest for: dormant
- when to use: They hosted before, and the committee has changed.

### Subject

{{club}} — new committee, saying hello again

### Body

{{greeting}}

{{company}} has worked with {{club}} at {{school}} before, and I wanted to reintroduce us: the committee changes every year, and I am this year's.

[Ask whether they are still willing, and give them an easy way out if not.]

Best wishes,
{{signature}}

---

## Merge fields

- `{{greeting}}` — "Hi Priya," — or "Hello," when we have no name
- `{{first_name}}` — The contact's first name, blank if unknown
- `{{contact_name}}` — Their full name
- `{{contact_title}}` — Their job title
- `{{company}}` — The company's name
- `{{site}}` — "your York site" — or "your site" with no city
- `{{city}}` — The city on the record
- `{{what_they_do}}` — Their industry, or the record type
- `{{club}}` — Your club name, from settings
- `{{school}}` — Your school, from settings
- `{{group_size}}` — How many students, from settings
- `{{visit_length}}` — How long a visit takes, from settings
- `{{my_name}}` — Your name
- `{{my_email}}` — Your email address
- `{{signature}}` — Your name, club, school and email, over four lines
