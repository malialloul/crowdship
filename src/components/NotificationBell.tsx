import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Bell } from 'lucide-react'
import { useNotifications } from '../notifications/notifications-context'
import { dateTime } from '../lib/format'

export function NotificationBell() {
  const { items, unread, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && unread > 0) void markAllRead()
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
        className="btn btn-quiet relative h-9 w-9 px-0"
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full bg-signal px-1 text-xs font-bold text-ink">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="panel fixed inset-x-4 top-16 z-40 overflow-hidden shadow-lg sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[22rem]">
          <p className="border-b border-line px-4 py-2.5 font-display text-lg font-semibold">Notifications</p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-soft">Offers, counter-offers and payment updates show up here.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link to={n.link ?? '#'} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-paper">
                    <p className="text-[15px] font-semibold">{n.title}</p>
                    {n.body && <p className="text-sm text-ink-soft">{n.body}</p>}
                    <p className="mt-0.5 text-xs text-mist">{dateTime(n.created_at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
