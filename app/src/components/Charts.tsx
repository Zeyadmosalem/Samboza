import { useEffect, useState } from 'react'

/**
 * The four charts §5 asks for, as inline SVG.
 *
 * No chart library. The plan named Victory for React-Native compatibility, and
 * Capacitor removed that constraint — it ships this same web bundle — so the
 * choice is now 200KB of someone else's opinions against about 300 lines that
 * do exactly what the design rules require. The rules are specific enough
 * (2px surface gaps, rounded data-ends anchored to the baseline, hairline
 * recessive grid, legend always, selective direct labels) that fighting a
 * library into them costs more than drawing them.
 *
 * COLOUR IS VALIDATED, NOT CHOSEN. Every hue here is a slot from the palette
 * the validator signed off on, in both modes:
 *
 *   categorical  7 slots, worst adjacent CVD ΔE 9.1 light / 8.4 dark
 *   income/expense  ΔE 6.9 light / 6.5 dark — inside the 6–8 band, which is
 *   legal ONLY with secondary encoding, so those bars carry a fixed position
 *   within each group, an always-present legend, and axis labels.
 *
 * Three light-mode slots fall below 3:1 against white. That is a WARN the
 * rules do not let you dismiss: it obliges visible labels or a table view.
 * Reports ships both.
 */

/* ------------------------------------------------------------------ theme */

/** Dark mode is a SELECTED palette. These are the same eight hues re-stepped
 *  for a dark surface — not an automatic lightening, which would break the
 *  lightness band and the contrast floor at once. */
const DARK_STEP: Record<string, string> = {
  '#2a78d6': '#3987e5', '#eb6834': '#d95926', '#1baf7a': '#199e70',
  '#eda100': '#c98500', '#e87ba4': '#d55181', '#008300': '#008300',
  '#4a3aa7': '#9085e9', '#e34948': '#e66767', '#8a9490': '#9aa4a0',
}

export const step = (hex: string, dark: boolean) =>
  dark ? (DARK_STEP[hex.toLowerCase()] ?? hex) : hex

/** The toggle writes data-theme and does not announce it, so watch the
 *  attribute as well as the OS setting. */
export function useIsDark() {
  const read = () => {
    const set = document.documentElement.dataset.theme
    if (set === 'dark') return true
    if (set === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  const [dark, setDark] = useState(read)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setDark(read())
    mq.addEventListener('change', onChange)
    const obs = new MutationObserver(onChange)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { mq.removeEventListener('change', onChange); obs.disconnect() }
  }, [])
  return dark
}

/* ------------------------------------------------------------------ parts */

interface Tip { x: number; y: number; lines: string[] }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div className="charttip" style={{ left: tip.x, top: tip.y }}>
      {tip.lines.map((l, i) => (
        <div key={i} className={i ? 'v' : 'k'}>{l}</div>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; colour: string }[] }) {
  return (
    <div className="legend">
      {items.map(i => (
        <span className="legenditem" key={i.label}>
          <span className="swatch" style={{ background: i.colour }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

/** A bar with its data-end rounded and its base square, so the mark stays
 *  anchored to the baseline it is measured from. */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.min(r, w / 2, Math.max(h, 0))
  if (h <= 0) return ''
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y}`
       + ` L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr}`
       + ` L${x + w},${y + h} Z`
}

const GAP = 2   // the surface gap between fills, everywhere

/* ------------------------------------------------- income vs expense, bars */

export function MonthBars({ data, labels, fmt, series }: {
  data: { month: string; income: number; expense: number }[]
  labels: string[]
  fmt: (n: number) => string
  series: { income: string; expense: string; incomeLabel: string; expenseLabel: string }
}) {
  const [tip, setTip] = useState<Tip | null>(null)
  const W = 720, H = 240, PAD = { t: 12, r: 12, b: 28, l: 64 }
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b
  const max = Math.max(1, ...data.flatMap(d => [d.income, d.expense]))
  const ticks = niceTicks(max, 4)
  const scale = (v: number) => plotH - (v / ticks[ticks.length - 1]) * plotH
  const slot = plotW / Math.max(data.length, 1)
  const bw = Math.max(6, (slot - GAP * 3) / 2)

  return (
    <div className="chartbox">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
           onMouseLeave={() => setTip(null)}>
        <g transform={`translate(${PAD.l},${PAD.t})`}>
          {/* Solid hairlines, one shade off the surface. Never dashed: a
              dashed grid reads as a threshold that isn't there. */}
          {ticks.map(v => (
            <g key={v}>
              <line x1={0} x2={plotW} y1={scale(v)} y2={scale(v)} className="gridline" />
              <text x={-10} y={scale(v)} dy="0.32em" className="axistick" textAnchor="end">
                {fmt(v)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = i * slot
            // Income always left, expense always right. That fixed position is
            // the secondary encoding the 6.9 ΔE pair requires.
            return (
              <g key={d.month}>
                <path d={barPath(x + GAP, scale(d.income), bw, plotH - scale(d.income))}
                      fill={series.income}
                      onMouseMove={e => setTip(at(e, [labels[i], `${series.incomeLabel} ${fmt(d.income)}`]))} />
                <path d={barPath(x + GAP * 2 + bw, scale(d.expense), bw, plotH - scale(d.expense))}
                      fill={series.expense}
                      onMouseMove={e => setTip(at(e, [labels[i], `${series.expenseLabel} ${fmt(d.expense)}`]))} />
                <text x={x + slot / 2} y={plotH + 18} className="axistick" textAnchor="middle">
                  {labels[i]}
                </text>
              </g>
            )
          })}
          <line x1={0} x2={plotW} y1={plotH} y2={plotH} className="axisline" />
        </g>
      </svg>
      <Tooltip tip={tip} />
      <Legend items={[
        { label: series.incomeLabel, colour: series.income },
        { label: series.expenseLabel, colour: series.expense },
      ]} />
    </div>
  )
}

/* -------------------------------------------------------- spending, donut */

export function Donut({ slices, total, fmt }: {
  slices: { key: string; label: string; amount: number; colour: string }[]
  total: number
  fmt: (n: number) => string
}) {
  const [tip, setTip] = useState<Tip | null>(null)
  const S = 240, R = 100, INNER = 62, C = S / 2
  if (!total) return null

  // A genuine gap in the arc, not a stroke drawn around each segment. A ring
  // of outlined slices reads as chrome; a gap reads as separation.
  const gapAngle = GAP / R
  let a0 = -Math.PI / 2

  return (
    <div className="chartbox donutbox">
      <svg viewBox={`0 0 ${S} ${S}`} className="chart donut" role="img"
           onMouseLeave={() => setTip(null)}>
        {slices.map(s => {
          const sweep = (s.amount / total) * Math.PI * 2
          const a1 = a0 + sweep
          const d = arc(C, C, R, INNER, a0 + gapAngle / 2, a1 - gapAngle / 2)
          a0 = a1
          return (
            <path key={s.key} d={d} fill={s.colour}
                  onMouseMove={e => setTip(at(e, [s.label,
                    `${fmt(s.amount)} · ${Math.round((s.amount / total) * 100)}%`]))} />
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

function arc(cx: number, cy: number, r: number, ri: number, a0: number, a1: number) {
  if (a1 <= a0) return ''
  const big = a1 - a0 > Math.PI ? 1 : 0
  const p = (rad: number, ang: number) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]
  const [x0, y0] = p(r, a0), [x1, y1] = p(r, a1)
  const [u1, v1] = p(ri, a1), [u0, v0] = p(ri, a0)
  return `M${x0},${y0} A${r},${r} 0 ${big} 1 ${x1},${y1}`
       + ` L${u1},${v1} A${ri},${ri} 0 ${big} 0 ${u0},${v0} Z`
}

/* ----------------------------------------------------------- trend, line */

export function TrendLine({ data, labels, fmt, colour, label }: {
  data: number[]; labels: string[]; fmt: (n: number) => string
  colour: string; label: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 720, H = 220, PAD = { t: 14, r: 14, b: 28, l: 64 }
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b
  const lo = Math.min(0, ...data), hi = Math.max(1, ...data)
  const ticks = niceTicks(hi, 4, lo)
  const top = ticks[ticks.length - 1], bottom = ticks[0]
  const y = (v: number) => plotH - ((v - bottom) / (top - bottom || 1)) * plotH
  const x = (i: number) => (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW)
  const path = data.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')

  return (
    <div className="chartbox">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
           onMouseLeave={() => setHover(null)}>
        <g transform={`translate(${PAD.l},${PAD.t})`}>
          {ticks.map(v => (
            <g key={v}>
              <line x1={0} x2={plotW} y1={y(v)} y2={y(v)} className="gridline" />
              <text x={-10} y={y(v)} dy="0.32em" className="axistick" textAnchor="end">{fmt(v)}</text>
            </g>
          ))}
          {bottom < 0 && <line x1={0} x2={plotW} y1={y(0)} y2={y(0)} className="axisline" />}

          <path d={path} className="trend" style={{ stroke: colour }} />

          {data.map((v, i) => (
            <g key={i}>
              {/* A hit target far bigger than the mark, so a phone can hit it. */}
              <rect x={x(i) - plotW / (data.length * 2)} y={0}
                    width={plotW / data.length} height={plotH} fill="transparent"
                    onMouseMove={() => setHover(i)} />
              <circle cx={x(i)} cy={y(v)} r={hover === i ? 6 : 4}
                      style={{ fill: colour }} className="trendpoint" />
              <text x={x(i)} y={plotH + 18} className="axistick" textAnchor="middle">{labels[i]}</text>
            </g>
          ))}
          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={plotH} className="crosshair" />
          )}
          <line x1={0} x2={plotW} y1={plotH} y2={plotH} className="axisline" />
        </g>
      </svg>
      {hover != null && (
        <div className="charttip static">
          <div className="k">{labels[hover]}</div>
          <div className="v">{label} {fmt(data[hover])}</div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------ per person, bars across */

export function PersonBars({ rows, fmt }: {
  rows: { key: string; label: string; amount: number; colour: string }[]
  fmt: (n: number) => string
}) {
  const max = Math.max(1, ...rows.map(r => r.amount))
  return (
    <div className="hbars">
      {rows.map(r => (
        <div className="hbar" key={r.key}>
          <span className="hbarlabel">{r.label}</span>
          <span className="hbartrack">
            <span className="hbarfill"
                  style={{ width: `${Math.max(2, (r.amount / max) * 100)}%`, background: r.colour }} />
          </span>
          {/* One series, so every bar is slot 1 — colouring them by size would
              double-encode length as hue and say nothing new. The value is
              direct-labelled instead. */}
          <span className="hbarvalue">{fmt(r.amount)}</span>
        </div>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------- shared */

function at(e: React.MouseEvent, lines: string[]): Tip {
  const box = (e.currentTarget as SVGElement).closest('.chartbox') as HTMLElement
  const r = box.getBoundingClientRect()
  return { x: e.clientX - r.left + 12, y: e.clientY - r.top + 12, lines }
}

/** Round tick values, so the axis reads 0 / 5,000 / 10,000 rather than
 *  0 / 4,317 / 8,634. */
function niceTicks(hi: number, count: number, lo = 0): number[] {
  const span = hi - lo || 1
  const raw = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const stepSize = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? mag * 10
  // The top tick must be at or ABOVE the largest value, or a bar taller than
  // the last tick is drawn with a negative y and escapes the plot — which is
  // exactly what it did: May's income bar climbed out of the card and sat on
  // top of the subtitle. Ceil the top, floor the bottom.
  const start = Math.floor(lo / stepSize) * stepSize
  const end = Math.ceil(hi / stepSize) * stepSize
  const out: number[] = []
  for (let v = start; v <= end + stepSize * 0.001; v += stepSize) out.push(Math.round(v))
  return out.length >= 2 ? out : [start, start + stepSize]
}
