import { DIMENSIONS } from '../content'

/**
 * The eight project dimensions, drawn as the mark draws them: eight octagonal
 * modules in a ring around a centre.
 *
 * The geometry is the argument: eight sides, eight dimensions, one connected
 * whole, so it is worth drawing properly rather than as eight rounded pills.
 * The centre names what does the connecting, and the drawing says it three
 * times over. A spoke runs from the centre to every dimension, because every
 * record carries the activity it belongs to. An octagonal orbit joins each
 * dimension to its neighbours. And the chords behind both say that any
 * dimension can reach any other.
 */

// The box is wider than it is tall, and wider than the ring needs: the labels
// sit outside the ring, and the longest of them ("Procurement") has to fit
// without being clipped. The height is cropped to what the drawing uses, so the
// ring does not float in a square of empty page.
const WIDTH = 640
const HEIGHT = 524
const CX = WIDTH / 2
const CY = HEIGHT / 2
const RING = 172
const NODE = 56
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
      x: CX + RING * cos,
      y: CY + RING * sin,
      labelX: CX + LABEL * cos,
      labelY: CY + LABEL * sin,
      // Labels lean away from the centre so they never sit over the ring.
      anchor: (Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end') as
        | 'middle'
        | 'start'
        | 'end',
      baseline: (Math.abs(cos) < 0.2
        ? sin > 0
          ? 'hanging'
          : 'auto'
        : 'central') as 'hanging' | 'auto' | 'central',
    }
  })

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className='mx-auto w-full max-w-[660px]'
      role='img'
      aria-label='The eight project dimensions, connected through the activity each record belongs to: schedule, cost, procurement, materials, commercial, safety, quality and documents.'
    >
      {/* Any dimension can reach any other: the chords, kept quiet. */}
      <g stroke='var(--octa-royal-blue)' strokeWidth={0.7} opacity={0.14}>
        {nodes.map((from, i) =>
          nodes
            .slice(i + 1)
            .map((to) => (
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

      {/* The orbit: each dimension sits beside the two it touches most. */}
      <polygon
        points={nodes.map((node) => `${node.x},${node.y}`).join(' ')}
        fill='none'
        stroke='var(--octa-royal-blue)'
        strokeWidth={1.3}
        opacity={0.3}
      />

      {/* The spokes: every record reaches the centre, which is the whole claim. */}
      <g stroke='var(--octa-royal-blue)' strokeWidth={1.3} opacity={0.42}>
        {nodes.map((node) => (
          <line key={node.label} x1={CX} y1={CY} x2={node.x} y2={node.y} />
        ))}
      </g>

      {/* The centre: the key every record carries. */}
      {/* a fade, not a disc: a hard-edged circle reads as a smudge */}
      <defs>
        <radialGradient id='octa-ring-centre'>
          <stop
            offset='0%'
            stopColor='var(--octa-royal-blue)'
            stopOpacity={0.14}
          />
          <stop
            offset='100%'
            stopColor='var(--octa-royal-blue)'
            stopOpacity={0}
          />
        </radialGradient>
      </defs>
      <circle cx={CX} cy={CY} r={104} fill='url(#octa-ring-centre)' />
      <polygon
        points={octagon(CX, CY, 63)}
        fill='var(--octa-midnight-indigo)'
      />
      <text
        x={CX}
        y={CY - 7}
        textAnchor='middle'
        dominantBaseline='central'
        style={{
          fill: 'rgba(255,255,255,0.7)',
          fontSize: 9,
          letterSpacing: 1.4,
        }}
      >
        LINKED BY
      </text>
      <text
        x={CX}
        y={CY + 10}
        textAnchor='middle'
        dominantBaseline='central'
        className='font-display'
        style={{ fill: '#fff', fontSize: 14, fontWeight: 700 }}
      >
        Activity ID
      </text>

      {nodes.map((node) => (
        <g key={node.label}>
          {/* opaque, so the spoke and the chords stop at the node's edge */}
          <polygon
            points={octagon(node.x, node.y, NODE / 2)}
            fill='var(--card)'
            stroke={node.color}
            strokeWidth={2}
          />
          <polygon
            points={octagon(node.x, node.y, NODE / 2 - 8)}
            fill={node.color}
            opacity={0.26}
          />
          <text
            x={node.labelX}
            y={node.labelY}
            textAnchor={node.anchor}
            dominantBaseline={node.baseline}
            className='font-display'
            style={{ fill: node.color, fontSize: 13, fontWeight: 700 }}
          >
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
