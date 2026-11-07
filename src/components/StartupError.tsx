export function StartupError({ message }: { message: string }) {
  const isConfig = message.includes('VITE_SUPABASE')
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="panel space-y-4 p-6">
        <h1 className="text-3xl">The app couldn't start</h1>
        <p className="alert-error break-words">{message}</p>
        {isConfig ? (
          <p className="text-ink-soft">
            Add <code className="font-semibold">VITE_SUPABASE_URL</code> and{' '}
            <code className="font-semibold">VITE_SUPABASE_ANON_KEY</code> to your hosting environment variables, then
            redeploy. On Netlify: Project configuration → Environment variables, then Deploys → Trigger deploy → Clear
            cache and deploy site.
          </p>
        ) : (
          <p className="text-ink-soft">Reload the page. If this keeps happening, check the browser console.</p>
        )}
      </div>
    </div>
  )
}
