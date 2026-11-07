import { NavLink, Outlet } from 'react-router'
import { LogOut } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { APP_NAME } from '../lib/supabase'

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-md bg-ink" aria-hidden>
        <svg viewBox="0 0 32 32" className="size-5">
          <path d="M6 16h15m-5-6 6 6-6 6" stroke="#ffc72c" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="font-display text-xl font-bold tracking-tight">{APP_NAME}</span>
    </span>
  )
}

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-[15px] font-semibold ${isActive ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'}`

export function AppShell() {
  const { profile, signOut } = useAuth()

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <NavLink to="/profile" aria-label={`${APP_NAME} home`}>
            <Wordmark />
          </NavLink>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:ml-6 sm:w-auto" aria-label="Main">
            <NavLink to="/profile" className={linkCls}>
              Profile
            </NavLink>
            <NavLink to="/payments" className={linkCls}>
              Payments
            </NavLink>
            {profile?.role === 'admin' && (
              <>
                <NavLink to="/admin/kyc" className={linkCls}>
                  ID reviews
                </NavLink>
                <NavLink to="/admin/escrow" className={linkCls}>
                  Escrow
                </NavLink>
              </>
            )}
          </nav>
          <button type="button" onClick={() => void signOut()} className="btn btn-quiet ml-auto h-9 px-3 text-sm">
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}
