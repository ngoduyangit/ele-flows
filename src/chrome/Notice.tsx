import { LoaderCircle, X } from 'lucide-react'
import { useEffect } from 'react'
import { useFlow } from '../store/flowStore'
import { cn } from '../components/ui'

/** Bottom-center status line for one-off actions . Success fades after 12 s. */
export function Notice() {
  const notice = useFlow((s) => s.notice)
  const setNotice = useFlow((s) => s.setNotice)
  useEffect(() => {
    if (!notice || notice.busy || notice.error) return
    const t = setTimeout(() => setNotice(null), 12000)
    return () => clearTimeout(t)
  }, [notice, setNotice])
  if (!notice) return null
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] max-w-[560px] w-[calc(100%-32px)]">
      <div className={cn('flex items-start gap-2 rounded-xl bg-popover shadow-popover px-3 py-2.5 text-sm animate-pop', notice.error && 'text-red-600')}>
        {notice.busy && <LoaderCircle className="w-4 h-4 mt-0.5 shrink-0 animate-spin" />}
        <span className="flex-1">{notice.text}</span>
        {!notice.busy && (
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 rounded-md p-0.5 hover:bg-gray-alpha-100" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
