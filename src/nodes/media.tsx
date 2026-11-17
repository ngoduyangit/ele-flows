import { Play } from 'lucide-react'
import { useState } from 'react'
import type { Generation, PortType } from '../lib/types'
import { GenerationPlaceholder } from './parts'
import { posterUrl, thumbUrl } from '../lib/thumb'

export function MediaPreview({ gen, kind, emptyText, running, fit = 'cover' }: { gen?: Generation; kind: PortType; emptyText?: string; running?: boolean; fit?: 'cover' | 'contain' }) {
  const fitCls = fit === 'contain' ? 'object-contain' : 'object-cover'
  if (running || gen?.status === 'running') return <GenerationPlaceholder running />
  if (gen?.status === 'error')
    return (
      <div className="w-full h-full stack items-center justify-center gap-1 p-4 text-center">
        <p className="text-xs font-medium text-red-600">Generation failed</p>
        <p className="text-xs text-subtle line-clamp-3">{gen.error}</p>
      </div>
    )
  if (!gen || (!gen.url && !gen.text)) return <GenerationPlaceholder text={emptyText} />
  if (gen.text) return <div className="w-full h-full overflow-y-auto nowheel scrollbar-thin px-3.5 py-3 text-sm whitespace-pre-wrap">{gen.text}</div>
  if (kind === 'video') {
    if (gen.url!.startsWith('data:image')) return <img src={gen.url} className={`w-full h-full ${fitCls} node-content-media`} draggable={false} />
    return <LazyVideo src={gen.url!} className={`w-full h-full ${fitCls}`} />
  }
  return <img src={thumbUrl(gen.url)} className="w-full h-full object-cover node-content-media" draggable={false} decoding="async" />
}

/**
 * A clip on the canvas shows only its poster frame; the video is fetched when the user presses play
 * (loading every clip of a big flow made the whole editor stutter).
 */
export function LazyVideo({ src, className, rounded }: { src: string; className?: string; rounded?: string }) {
  const [active, setActive] = useState(false)
  if (active) return <video src={src} className={className} controls autoPlay playsInline />
  const poster = posterUrl(src)
  return (
    <div className={`relative ${className ?? ''} ${rounded ?? ''} overflow-hidden bg-gray-900`}>
      {poster && <img src={poster} className="w-full h-full object-cover" draggable={false} decoding="async" />}
      <button
        type="button"
        title="Play"
        onClick={(e) => {
          e.stopPropagation()
          setActive(true)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="nodrag absolute inset-0 m-auto w-12 h-12 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center backdrop-blur-sm"
      >
        <Play className="w-5 h-5 ml-0.5" fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  )
}

