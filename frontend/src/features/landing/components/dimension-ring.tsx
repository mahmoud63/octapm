import { DIMENSIONS } from '../content'

/**
 * The eight project dimensions, drawn as the mark draws them: eight octagonal
 * modules in a ring around a centre.
 *
 * The geometry is the argument — eight sides, eight dimensions, one connected
 * whole — so it is worth drawing properly rather than as eight rounded pills.
 * The centre names what actually does the connecting: every record in the
 * platform carries the activity it belongs to.
 */

// The box is wider than the ring needs: the labels sit outside it, and the
// longest of them ("Procurement") has to fit without being clipped.
const SIZE = 640
const C = SIZE / 2
const RING = 168
const NODE = 54
const LABEL = RING + NODE / 2 + 22

/** A regular octagon of the given radius, flat side up. */
function octagon(cx: number, cy: number, r: number) {
  return Array.from({ length: 8 }, (_, i) => {
    const angle = (Math.PI / 4) * i + Math.PI / 8
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`
  }).join(' ')
}

export function DimensionRing() {
  const nodes = DIMENSIONS.map((dimension, i) => {
    // Start at the top and run clockwise, so Schedule leads.
    const angle = (Math.PI * 2 * i) / 8 - Math.PI / 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return {
      ...dimension,
      x: C + RING * cos,
      y: C + RING * sin,
      labelX: C + LABEL * cos,
      labelY: C + LABEL * sin,
      // Labels lean away from the centre so they never sit over the ring.
      anchor: (Math.abs(cos) < 0.2
        ? 'middle'
        : cos > 0
          ? 'start'
          : 'end') as 'middle' | 'start' | 'end',
      baseline: (Math.abs(cos) < 0.2
        ? sin > 0
          ? 'hanging'
          : 'auto'
        : 'central') as 'hanging' | 'auto' | 'central',
    }
  })

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className='mx-auto w-full max-w-[620px]'
      role='img'
      aria-label='The eight project dimensions, connected through the activity each record belongs to: schedule, cost, procurement, materials, commercial, safety, quality and documents.'
    >
      {/* Every dimension feeds every other, so draw all the chords — quietly. */}
      <g stroke='var(--octa-royal-blue)' strokeWidth={0.7} opacity={0.22}>
        {nodes.map((from, i) =>
          nodes.slice(i + 1).map((to) => (
            <line
              key={`${from.label}-${to.label}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          ))
        )}
      </g>

      {/* The centre: the key every record carries. */}
      <polygon points={octagon(C, C, 62)} fill='var(--octa-midnight-indigo)' />
      <text
        x={C}
        y={C - 7}
        textAnchor='middle'
        dominantBaseline='central'
        style={{ fill: 'rgba(255,255,255,0.6)', fontSize: 9, letterSpacing: 1.4 }}
      >
        LINKED BY
      </text>
      <text
        x={C}
        y={C + 10}
        textAnchor='middle'
        dominantBaseline='central'
        className='font-display'
        style={{ fill: '#fff', fontSize: 14, fontWeight: 700 }}
      >
        Activity ID
      </text>

      {nodes.map((node) => (
        <g key={node.label}>
          <polygon
            points={octagon(node.x, node.y, NODE / 2)}
            fill='var(--card)'
            stroke={node.color}
            strokeWidth={1.75}
          />
          <polygon
            points={octagon(node.x, node.y, NODE / 2 - 9)}
            fill={node.color}
            opacity={0.16}
          />
          <text
            x={node.labelX}
            y={node.labelY}
            textAnchor={node.anchor}
            dominantBaseline={node.baseline}
            className='font-display'
            style={{ fill: node.color, fontSize: 12.5, fontWeight: 700 }}
          >
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
