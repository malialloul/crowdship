import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { X } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { listNotifications, markAllRead as markAllReadApi, subscribeToNotifications } from '../services/notifications'
import type { AppNotification } from '../lib/database.types'
import { NotificationsContext, type NotificationsState } from './notifications-context'

function Toast({ n, onClose }: { n: AppNotification; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [n.id, onClose])

  const content = (
    <>
      <p className="truncate font-display text-lg font-semibold leading-tight">{n.title}</p>
      {n.body && <p className="mt-0.5 line-clamp-2 text-sm text-white/75">{n.body}</p>}
    </>
  )
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-start gap-3 rounded-xl bg-ink p-4 text-white shadow-lg sm:inset-x-auto sm:right-6"
    >
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-signal" aria-hidden />
      {n.link ? (
        <Link to={n.link} onClick={onClose} className="min-w-0 flex-1">
          {content}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{content}</div>
      )}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="text-white/60 hover:text-white">
        <X className="size-4" />
      </button>
    </div>
  )
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [items, setItems] = useState<AppNotification[]>([])
  const [version, setVersion] = useState(0)
  const [toast, setToast] = useState<AppNotification | null>(null)

  useEffect(() => {
    if (!userId) {
      setItems([])
      return
    }
    let active = true
    listNotifications()
      .then((rows) => active && setItems(rows))
      .catch(() => undefined)
    const stop = subscribeToNotifications(userId, (n) => {
      setItems((prev) => [n, ...prev.filter((p) => p.id !== n.id)].slice(0, 30))
      setToast(n)
      setVersion((v) => v + 1)
    })
    return () => {
      active = false
      stop()
    }
  }, [userId])

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString()
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    await markAllReadApi().catch(() => undefined)
  }, [])

  const closeToast = useCallback(() => setToast(null), [])

  const value = useMemo<NotificationsState>(
    () => ({ items, unread: items.filter((n) => !n.read_at).length, version, markAllRead }),
    [items, version, markAllRead],
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {toast && <Toast n={toast} onClose={closeToast} />}
    </NotificationsContext.Provider>
  )
}
