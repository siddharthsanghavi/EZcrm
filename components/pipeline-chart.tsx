import Link from 'next/link';
import { STATUS_LABELS, type Status } from '@/lib/types';

export type StageCount = { status: Status; count: number };
export type Flow = { from: Status | null; to: Status; count: number };

const MAIN: Status[] = ['prospect', 'contacted', 'in_conversation', 'committed'];
const EXITS: Status[] = ['declined', 'dormant'];

// Referenced as CSS variables rather than literals: an inline SVG can't take
// Tailwind's `dark:` variants on `fill`, so the two palettes live in
// globals.css and the browser picks whichever the theme has defined.
const v = (name: string) => `var(--st-${name})`;

const FILL: Record<Status, { box: string; text: string; edge: string }> = {
  prospect:        { box: v('neutral-box'), text: v('neutral-text'), edge: v('neutral-edge') },
  contacted:       { box: v('blue-box'),    text: v('blue-text'),    edge: v('blue-edge')    },
  in_conversation: { box: v('amber-box'),   text: v('amber-text'),   edge: v('amber-edge')   },
  committed:       { box: v('green-box'),   text: v('green-text'),   edge: v('green-edge')   },
  declined:        { box: v('rose-box'),    text: v('rose-text'),    edge: v('rose-edge')    },
  dormant:         { box: v('neutral-box'), text: v('dormant-text'), edge: v('neutral-edge') },
};

// Geometry. Laid out by hand rather than with a graph library: four stages in a
// row with two exits below is a fixed shape, and hand-placing it keeps the SVG
// dependency-free and readable in both themes.
const BOX_W = 176;
const BOX_H = 84;
const GAP = 56;
const TOP_Y = 24;
const EXIT_Y = TOP_Y + BOX_H + 86;
const WIDTH = MAIN.length * BOX_W + (MAIN.length - 1) * GAP;
const HEIGHT = EXIT_Y + BOX_H + 28;

const xFor = (i: number) => i * (BOX_W + GAP);

export function PipelineChart({
  stages,
  flows,
}: {
  stages: StageCount[];
  flows: Flow[];
}) {
  const countOf = (s: Status) => stages.find((x) => x.status === s)?.count ?? 0;
  const flowBetween = (from: Status, to: Status) =>
    flows.find((f) => f.from === from && f.to === to)?.count ?? 0;

  const total = stages.reduce((a, s) => a + s.count, 0);
  const active = MAIN.reduce((a, s) => a + countOf(s), 0);

  return (
    <div className="card overflow-x-auto p-5">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full min-w-[760px]"
        role="img"
        aria-label="Outreach pipeline: companies by status"
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--st-arrow)" />
          </marker>
          <marker id="arrow-exit" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--st-arrow-soft)" />
          </marker>
        </defs>

        {/* Forward arrows between consecutive stages, labelled with how many
            companies have actually made that move. */}
        {MAIN.slice(0, -1).map((s, i) => {
          const moved = flowBetween(s, MAIN[i + 1]);
          const x1 = xFor(i) + BOX_W;
          const x2 = xFor(i + 1);
          const y = TOP_Y + BOX_H / 2;
          return (
            <g key={`edge-${s}`}>
              <line x1={x1 + 4} y1={y} x2={x2 - 6} y2={y}
                    stroke="var(--st-arrow)" strokeWidth="1.5" markerEnd="url(#arrow)" />
              {moved > 0 && (
                <text x={(x1 + x2) / 2} y={y - 9} textAnchor="middle"
                      fontSize="11" fill="var(--st-flow-label)" fontWeight="600">
                  {moved}
                </text>
              )}
            </g>
          );
        })}

        {/* Exits hang below the middle of the active pipeline. */}
        {EXITS.map((s, i) => {
          const cx = xFor(1) + BOX_W / 2 + i * (BOX_W + GAP);
          return (
            <line key={`exit-edge-${s}`}
                  x1={cx} y1={TOP_Y + BOX_H} x2={cx} y2={EXIT_Y - 6}
                  stroke="var(--st-arrow-soft)" strokeWidth="1.5" strokeDasharray="4 3"
                  markerEnd="url(#arrow-exit)" />
          );
        })}

        {MAIN.map((s, i) => (
          <StageBox key={s} status={s} x={xFor(i)} y={TOP_Y} count={countOf(s)} total={total} />
        ))}
        {EXITS.map((s, i) => (
          <StageBox key={s} status={s} x={xFor(1) + i * (BOX_W + GAP)} y={EXIT_Y}
                    count={countOf(s)} total={total} muted />
        ))}
      </svg>

      <p className="mt-3 text-xs text-black/50">
        {total.toLocaleString()} companies · {active.toLocaleString()} still in play ·
        numbers on arrows are companies that have actually moved that way.
      </p>
    </div>
  );
}

function StageBox({
  status,
  x,
  y,
  count,
  total,
  muted = false,
}: {
  status: Status;
  x: number;
  y: number;
  count: number;
  total: number;
  muted?: boolean;
}) {
  const c = FILL[status];
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <a href={`/companies?status=${status}`} aria-label={`${STATUS_LABELS[status]}: ${count}`}>
      <g opacity={muted ? 0.85 : 1}>
        <rect x={x} y={y} width={BOX_W} height={BOX_H} rx="10"
              fill={c.box} stroke={c.edge} strokeWidth="1.5" />
        <text x={x + 14} y={y + 30} fontSize="13" fill={c.text} fontWeight="600">
          {STATUS_LABELS[status]}
        </text>
        <text x={x + 14} y={y + 63} fontSize="26" fill={c.text} fontWeight="700">
          {count.toLocaleString()}
        </text>
        <text x={x + BOX_W - 14} y={y + 63} fontSize="11" fill={c.text} opacity="0.65"
              textAnchor="end">
          {pct}%
        </text>
      </g>
    </a>
  );
}

/** Plain-HTML legend + jump links, outside the SVG so they're properly focusable. */
export function PipelineLinks({ stages }: { stages: StageCount[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {[...MAIN, ...EXITS].map((s) => {
        const n = stages.find((x) => x.status === s)?.count ?? 0;
        return (
          <Link key={s} href={`/companies?status=${s}`}
                className="chip border border-black/10 bg-white hover:bg-black/[0.03]">
            {STATUS_LABELS[s]} · {n.toLocaleString()}
          </Link>
        );
      })}
    </div>
  );
}
