import { createContext, useContext, useEffect, useRef } from 'react'
import type { AppNotification } from '../lib/database.types'

export interface NotificationsState {
  items: AppNotification[]
  unread: number
  /** Bumps whenever a live notification arrives; pages reload on change. */
  version: number
  markAllRead: () => Promise<void>
}

export const NotificationsContext = createContext<NotificationsState | null>(null)

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationsProvider>')
  return ctx
}

/** Re-runs `reload` when something happens to this user (new offer, counter, payment…). */
export function useLiveRefresh(reload: () => void): void {
  const { version } = useNotifications()
  const first = useRef(true)
  const latest = useRef(reload)
  latest.current = reload
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    latest.current()
  }, [version])
}
