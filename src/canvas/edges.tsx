import { BaseEdge, getBezierPath, type ConnectionLineComponentProps, type EdgeProps } from '@xyflow/react'
import { getInputPort, getOutputType } from '../lib/registry'
import type { PortType } from '../lib/types'
import { useFlow } from '../store/flowStore'

export const PORT_OKLCH: Record<PortType, string> = {
  text: '0.7 0 0',
  image: '0.63 0.21 249.86',
  video: '0.58 0.27 289.97',
}

export function DataFlowEdge({ id, source, target, targetHandleId: targetHandle, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }: EdgeProps) {
  const srcType = useFlow((s) => getOutputType(s.nodes.find((n) => n.id === source))) ?? 'text'
  const tgtType = useFlow((s) => getInputPort(s.nodes.find((n) => n.id === target), targetHandle)?.type) ?? srcType
  const highlighted = useFlow((s) => s.nodes.some((n) => n.selected && (n.id === source || n.id === target)))
  // the target is generating (in the editor or through an API run) → animate its inputs
  const running = useFlow((s) => !!s.running[target] || !!s.nodes.find((n) => n.id === target)?.data.generations?.some((g) => g.status === 'running'))
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const gid = `edge-gradient-${id}`
  const op = selected || highlighted || running ? 1 : 0.35
  return (
    <>
      <defs>
        <linearGradient id={gid} className="flow-edge-gradient" gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor={`oklch(${PORT_OKLCH[srcType]} / ${op})`} />
          <stop offset="100%" stopColor={`oklch(${PORT_OKLCH[tgtType]} / ${op})`} />
        </linearGradient>
      </defs>
      <BaseEdge id={id} path={path} className="flow-edge" style={{ stroke: `url(#${gid})` }} interactionWidth={20} />
      {running && <path d={path} className="flow-edge-running" fill="none" stroke={`oklch(${PORT_OKLCH[srcType]})`} />}
    </>
  )
}

export function ConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition, fromNode, fromHandle, connectionStatus }: ConnectionLineComponentProps) {
  const node = useFlow((s) => s.nodes.find((n) => n.id === fromNode?.id))
  const type: PortType =
    (fromHandle?.type === 'source' ? getOutputType(node) : getInputPort(node, fromHandle?.id)?.type) ?? 'text'
  const [path] = getBezierPath({ sourceX: fromX, sourceY: fromY, sourcePosition: fromPosition, targetX: toX, targetY: toY, targetPosition: toPosition })
  return (
    <g>
      <path d={path} fill="none" strokeWidth={2} stroke={`oklch(${PORT_OKLCH[type]} / ${connectionStatus === 'invalid' ? 0.35 : 0.9})`} strokeDasharray={connectionStatus === 'invalid' ? '4 4' : undefined} />
      <circle cx={toX} cy={toY} r={4} fill={`oklch(${PORT_OKLCH[type]})`} />
    </g>
  )
}
