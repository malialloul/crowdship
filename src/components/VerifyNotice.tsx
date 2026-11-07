import { Link } from 'react-router'
import { useAuth } from '../auth/auth-context'

/** Shown above marketplace actions until the user's ID is approved. */
export function VerifyNotice({ action }: { action: string }) {
  const { profile } = useAuth()
  if (!profile || profile.kyc_status === 'verified') return null
  const pending = profile.kyc_status === 'pending'
  return (
    <div className="rounded-lg border border-signal-deep bg-signal-wash px-4 py-3 text-[15px]">
      {pending ? (
        <>Your ID is being reviewed. You can {action} as soon as it's approved.</>
      ) : (
        <>
          Verify your identity to {action}.{' '}
          <Link to="/profile" className="font-semibold underline underline-offset-4">
            Upload your ID
          </Link>
        </>
      )}
    </div>
  )
}
