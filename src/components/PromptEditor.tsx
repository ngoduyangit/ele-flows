import { mergeAttributes, Node as TiptapNode } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getOutputType, getPorts, nodeIcon } from '../lib/registry'
import type { DocJSON } from '../lib/types'
import { useFlow } from '../store/flowStore'
import { cn } from './ui'

/* ------------------------------------------------------------------ */
/* prompt-tag inline node (node reference chip)                       */
/* ------------------------------------------------------------------ */

function PromptTagView({ node }: NodeViewProps) {
  const id = String(node.attrs.id ?? '').replace(/^node:/, '')
  const label = useFlow((s) => s.nodes.find((n) => n.id === id)?.data.label) ?? node.attrs.label
  const missing = !useFlow((s) => s.nodes.some((n) => n.id === id))
  return (
    <NodeViewWrapper as="span" className="inline-block px-px whitespace-normal">
      <span
        className={cn(
          'inline-flex items-center px-1 rounded-lg text-xm font-medium relative -top-px border transition duration-100',
          missing ? 'bg-gray-alpha-100 text-secondary border-gray-alpha-150 line-through' : 'bg-blue-50 text-blue-700 border-blue-100',
        )}
        contentEditable={false}
      >
        @{label}
      </span>
    </NodeViewWrapper>
  )
}

const PromptTag = TiptapNode.create({
  name: 'prompt-tag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { id: { default: null }, type: { default: 'node-reference' }, label: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'span[data-prompt-tag]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-prompt-tag': '' }), `@${HTMLAttributes.label}`]
  },
  renderText({ node }) {
    return `@${node.attrs.label}`
  },
  addNodeView() {
    return ReactNodeViewRenderer(PromptTagView)
  },
})

/* ------------------------------------------------------------------ */
/* Editor                                                             */
/* ------------------------------------------------------------------ */

/** Drop empty text nodes (invalid in ProseMirror – they make the editor discard the whole doc). */
function clean(n: any): any {
  if (!n || typeof n !== 'object') return n
  if (!Array.isArray(n.content)) return n
  const content = n.content.filter((c: any) => !(c?.type === 'text' && !c.text)).map(clean)
  if (!content.length && n.type !== 'doc') {
    const { content: _c, ...rest } = n
    return rest
  }
  return { ...n, content: content.length ? content : [{ type: 'paragraph' }] }
}

export function toDoc(v: DocJSON | string | undefined | null): DocJSON {
  if (v && typeof v === 'object') return clean(v)
  if (!v) return { type: 'doc', content: [{ type: 'paragraph' }] }
  if (typeof v === 'string')
    return {
      type: 'doc',
      content: v.split('\n').map((line) => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })),
    }
  return v
}

export { docToPlain } from '../shared/runRequest'

interface Props {
  value: DocJSON | string | undefined
  onChange: (doc: DocJSON) => void
  placeholder?: string
  className?: string
  /** Node owning this editor – enables @-mentions of other nodes. */
  nodeId?: string
  /** Port to connect mentioned text nodes into. */
  mentionHandle?: string
  autoFocus?: boolean
}

export function PromptEditor({ value, onChange, placeholder, className, nodeId, mentionHandle = 'prompt', autoFocus }: Props) {
  const [mention, setMention] = useState<{ query: string; from: number; to: number; x: number; y: number } | null>(null)
  const [active, setActive] = useState(0)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastJson = useRef<string>('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, bulletList: false, orderedList: false, listItem: false, link: false }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      PromptTag,
    ],
    content: toDoc(value),
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: cn('tiptap ProseMirror whitespace-break-spaces outline-none', className ?? '') },
      // plain text with "@Label" (copied prompts, templates) → real node chips once it lands
      handlePaste: () => {
        setTimeout(() => linkRef.current(), 0)
        return false
      },
      handleKeyDown: (_view, e) => {
        if (!mentionRef.current) return false
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
          keyRef.current(e)
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as DocJSON
      lastJson.current = JSON.stringify(json)
      onChangeRef.current(json)
      detectMention()
    },
    onSelectionUpdate: () => detectMention(),
    onBlur: () => {
      linkRef.current()
      setTimeout(() => setMention(null), 150)
    },
  })

  // keep editor in sync when value changes externally (undo/redo, API runs)
  useEffect(() => {
    if (!editor) return
    const next = JSON.stringify(toDoc(value))
    if (next !== lastJson.current && next !== JSON.stringify(editor.getJSON())) {
      lastJson.current = next
      editor.commands.setContent(toDoc(value), { emitUpdate: false })
    }
  }, [value, editor])

  function detectMention() {
    if (!editor || !nodeId) return
    const { from, empty } = editor.state.selection
    if (!empty) return setMention(null)
    const $from = editor.state.selection.$from
    const textBefore = $from.parent.textBetween(Math.max(0, $from.parentOffset - 40), $from.parentOffset, undefined, '￼')
    const m = /(?:^|\s)@([\w\s-]{0,30})$/.exec(textBefore)
    if (!m) return setMention(null)
    const query = m[1]
    if (query.includes('  ')) return setMention(null)
    const coords = editor.view.coordsAtPos(from)
    setMention({ query, from: from - query.length - 1, to: from, x: coords.left, y: coords.bottom })
    setActive(0)
  }

  // Read the graph only while the @-menu is open – subscribing to `nodes` here would
  // re-render every prompt editor on every drag frame.
  const candidates = useMemo(() => {
    if (!mention || !nodeId) return []
    const { nodes, edges } = useFlow.getState()
    const self = nodes.find((n) => n.id === nodeId)
    const accepted = new Set(self ? getPorts(self).inputs.map((p) => p.type) : [])
    const connected = new Set(edges.filter((e) => e.target === nodeId).map((e) => e.source))
    const q = mention.query.trim().toLowerCase()
    return nodes
      .filter((n) => n.id !== nodeId && n.type !== 'comment')
      .filter((n) => accepted.has(getOutputType(n)!))
      .filter((n) => !q || n.data.label.toLowerCase().includes(q))
      .sort((a, b) => Number(connected.has(b.id)) - Number(connected.has(a.id)))
      .slice(0, 8)
  }, [mention, nodeId])

  /** Nodes this prompt may reference (accepted input types), connected ones first. */
  function referenceable() {
    const { nodes, edges } = useFlow.getState()
    const self = nodes.find((n) => n.id === nodeId)
    const accepted = new Set(self ? getPorts(self).inputs.map((p) => p.type) : [])
    const connected = new Set(edges.filter((e) => e.target === nodeId).map((e) => e.source))
    return nodes
      .filter((n) => n.id !== nodeId && n.type !== 'comment' && n.data.label && accepted.has(getOutputType(n)!))
      .sort((a, b) => Number(connected.has(b.id)) - Number(connected.has(a.id)))
  }

  /** Make sure the referenced node feeds this one (text → prompt port, media → port of its type). */
  function ensureEdge(targetId: string) {
    const s = useFlow.getState()
    const self = s.nodes.find((n) => n.id === nodeId)
    const target = s.nodes.find((n) => n.id === targetId)
    if (!self || !target || s.edges.some((e) => e.source === target.id && e.target === nodeId)) return
    const out = getOutputType(target)
    const typed = getPorts(self).inputs.filter((p) => p.type === out)
    // media mentions are references: never take over a single start/end-frame slot
    const port = out === 'text' ? getPorts(self).inputs.find((p) => p.id === mentionHandle) : (typed.find((p) => p.multiple) ?? typed[0])
    if (port) s.onConnect({ source: target.id, sourceHandle: 'output', target: nodeId!, targetHandle: port.id })
  }

  /** Turn typed/pasted "@Label" text into node chips (longest matching label wins, case-insensitive). */
  function linkMentions() {
    if (!editor || !nodeId || editor.isDestroyed) return
    const { state } = editor
    if (!state.doc.textContent.includes('@')) return
    const cands = referenceable().map((n) => ({ id: n.id, label: n.data.label as string, lower: (n.data.label as string).toLowerCase() }))
    if (!cands.length) return
    cands.sort((a, b) => b.label.length - a.label.length)
    const hits: { from: number; to: number; id: string; label: string }[] = []
    state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      const text = node.text
      const lower = text.toLowerCase()
      for (let i = text.indexOf('@'); i >= 0; i = text.indexOf('@', i + 1)) {
        const c = cands.find((c) => lower.startsWith(c.lower, i + 1) && !/[\p{L}\p{N}_]/u.test(text[i + 1 + c.label.length] ?? ''))
        if (c) {
          hits.push({ from: pos + i, to: pos + i + 1 + c.label.length, id: c.id, label: c.label })
          i += c.label.length
        }
      }
    })
    if (!hits.length) return
    const type = state.schema.nodes['prompt-tag']
    const tr = state.tr
    for (const h of hits.reverse()) tr.replaceWith(h.from, h.to, type.create({ id: `node:${h.id}`, type: 'node-reference', label: h.label }))
    editor.view.dispatch(tr)
    for (const id of new Set(hits.map((h) => h.id))) ensureEdge(id)
  }
  const linkRef = useRef(linkMentions)
  linkRef.current = linkMentions

  function choose(i: number) {
    const target = candidates[i]
    if (!editor || !mention || !target) return
    editor
      .chain()
      .focus()
      .deleteRange({ from: mention.from, to: mention.to })
      .insertContent([{ type: 'prompt-tag', attrs: { id: `node:${target.id}`, type: 'node-reference', label: target.data.label } }, { type: 'text', text: ' ' }])
      .run()
    ensureEdge(target.id)
    setMention(null)
  }

  const mentionRef = useRef(mention)
  mentionRef.current = mention && candidates.length ? mention : null
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e) => {
    if (e.key === 'ArrowDown') setActive((a) => (a + 1) % candidates.length)
    else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + candidates.length) % candidates.length)
    else if (e.key === 'Enter' || e.key === 'Tab') choose(active)
    else if (e.key === 'Escape') setMention(null)
  }

  return (
    <>
      <EditorContent editor={editor} className="nodrag nowheel cursor-text h-full" onKeyDown={(e) => e.stopPropagation()} />
      {mention && candidates.length > 0 &&
        createPortal(
          <div
            className="fixed z-[200] w-60 rounded-xl bg-popover p-1 shadow-popover animate-pop"
            style={{ left: mention.x, top: mention.y + 6 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="px-2 pt-1 pb-1 text-xs font-medium text-subtle">Reference a node</div>
            {candidates.map((n, i) => {
              const Icon = nodeIcon(n)
              return (
                <button
                  key={n.id}
                  type="button"
                  className={cn('flex w-full items-center gap-2 h-8 rounded-lg px-2 text-sm text-left', i === active && 'bg-gray-alpha-100')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                >
                  <Icon className="w-4 h-4 text-secondary shrink-0" strokeWidth={1.5} />
                  <span className="truncate">{n.data.label}</span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
