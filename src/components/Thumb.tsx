import { useState } from 'react'
import { Package } from 'lucide-react'

/** Product picture from another site. Falls back to an icon when the shop blocks hotlinking. */
export function Thumb({ src, className = 'size-14', iconClass = 'size-6' }: { src: string | null; className?: string; iconClass?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-paper ${className}`}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          className="size-full object-contain"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <Package className={`text-mist ${iconClass}`} aria-hidden />
      )}
    </div>
  )
}
