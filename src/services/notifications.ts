import { supabase } from '../lib/supabase'
import type { AppNotification } from '../lib/database.types'

export async function listNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return data
}

export async function markAllRead(): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
  if (error) throw error
}

/** Live inserts for this user (RLS limits the stream to their rows). */
export function subscribeToNotifications(userId: string, onInsert: (n: AppNotification) => void): () => void {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => onInsert(payload.new as AppNotification),
    )
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}
