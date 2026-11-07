import { useRef, useState, type FormEvent } from 'react'
import { Camera, Check, Copy, FileText, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { submitKyc, updateProfile, uploadAvatar, validateKycFile } from '../services/profile'
import { VerificationBadge } from '../components/StatusTags'
import { formatPhone, toE164 } from '../lib/phone'
import { messageOf } from '../lib/errors'
import { dateTime } from '../lib/format'
import type { Profile } from '../lib/database.types'

function initials(name: string | null, fallback: string) {
  const src = name?.trim() || fallback
  return src
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function AvatarPicker({ profile, onChanged }: { profile: Profile; onChanged: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await uploadAvatar(profile.id, file)
      await onChanged()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="group relative size-24 overflow-hidden rounded-full bg-ink text-white ring-4 ring-card"
        aria-label="Change profile picture"
      >
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="size-full object-cover" />
        ) : (
          <span className="font-display text-3xl font-bold">{initials(profile.full_name, profile.phone ?? profile.email ?? '?')}</span>
        )}
        <span className="absolute inset-x-0 bottom-0 flex h-8 items-center justify-center bg-ink/75 opacity-90 group-hover:opacity-100">
          <Camera className="size-4" aria-hidden />
        </span>
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      {busy && <span className="text-sm text-mist">Uploading…</span>}
      {error && <span className="text-sm text-stop">{error}</span>}
    </div>
  )
}

function DetailsForm({ profile, onSaved }: { profile: Profile; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(profile.full_name ?? '')
  const [whish, setWhish] = useState(profile.whish_phone ? formatPhone(profile.whish_phone) : '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    let whishE164: string | null = null
    if (whish.trim()) {
      const parsed = toE164(whish, '961')
      if (!parsed.ok) {
        setMsg({ ok: false, text: `Whish number: ${parsed.error}` })
        return
      }
      whishE164 = parsed.e164
    }
    setBusy(true)
    try {
      await updateProfile(profile.id, { full_name: name.trim() || null, whish_phone: whishE164 })
      await onSaved()
      setMsg({ ok: true, text: 'Details saved' })
    } catch (err) {
      setMsg({ ok: false, text: messageOf(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel space-y-5 p-6" noValidate>
      <h2 className="text-2xl">Your details</h2>
      <div>
        <label htmlFor="full_name" className="field-label">
          Full name
        </label>
        <input id="full_name" className="input" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <p className="field-hint">Use the name on your ID so the review goes through.</p>
      </div>
      <div>
        <label htmlFor="whish_phone" className="field-label">
          Whish number
        </label>
        <input
          id="whish_phone"
          className="input"
          type="tel"
          inputMode="tel"
          placeholder="71 123 456"
          value={whish}
          onChange={(e) => setWhish(e.target.value)}
        />
        <p className="field-hint">When you carry an order, your reward is paid to this Whish account. Leave empty to use your sign-in number.</p>
      </div>
      {msg && <p className={msg.ok ? 'alert-ok' : 'alert-error'} role="status">{msg.text}</p>}
      <button type="submit" className="btn btn-ink" disabled={busy}>
        {busy ? 'Saving…' : 'Save details'}
      </button>
    </form>
  )
}

function FileField({
  id,
  label,
  file,
  onChange,
}: {
  id: string
  label: string
  file: File | null
  onChange: (f: File | null) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <label
        htmlFor={id}
        className={`flex min-h-20 cursor-pointer items-center gap-3 rounded-md border-2 border-dashed px-4 py-3 ${
          file ? 'border-go bg-go-wash' : 'border-line bg-paper hover:border-ink-soft'
        }`}
      >
        {file ? <Check className="size-5 shrink-0 text-go" aria-hidden /> : <FileText className="size-5 shrink-0 text-mist" aria-hidden />}
        <span className="min-w-0 truncate text-[15px]">{file ? file.name : 'Choose a photo or PDF'}</span>
      </label>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </div>
  )
}

function IdentitySection({ profile, onSubmitted }: { profile: Profile; onSubmitted: () => Promise<void> }) {
  const [docType, setDocType] = useState<'national_id' | 'passport'>('national_id')
  const [front, setFront] = useState<File | null>(null)
  const [back, setBack] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (profile.kyc_status === 'pending') {
    return (
      <section className="panel space-y-3 p-6">
        <h2 className="text-2xl">Identity verification</h2>
        <p className="text-ink-soft">
          Your documents are with our team. Your badge switches to Verified as soon as they're approved, and you'll be able to pay and carry orders.
        </p>
      </section>
    )
  }

  if (profile.kyc_status === 'verified') {
    return (
      <section className="panel flex items-start gap-4 p-6">
        <ShieldCheck className="mt-1 size-7 shrink-0 text-go" aria-hidden />
        <div>
          <h2 className="text-2xl">Identity verified</h2>
          <p className="text-ink-soft">Approved {dateTime(profile.kyc_reviewed_at)}. Shoppers and travelers see your Verified badge.</p>
        </div>
      </section>
    )
  }

  function pick(setter: (f: File | null) => void) {
    return (f: File | null) => {
      setError(f ? validateKycFile(f) : null)
      setter(f)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!front || (docType === 'national_id' && !back)) {
      setError(docType === 'national_id' ? 'Add both sides of your ID card' : 'Add your passport photo page')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await submitKyc(profile.id, docType, front, docType === 'national_id' ? back : null)
      await onSubmitted()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel space-y-5 p-6" noValidate>
      <div>
        <h2 className="text-2xl">Verify your identity</h2>
        <p className="mt-1 text-ink-soft">Every shopper and traveler is checked before money moves. Only our review team can see your documents.</p>
      </div>

      {profile.kyc_status === 'rejected' && profile.kyc_rejection_reason && (
        <p className="alert-error">Your last submission was declined: {profile.kyc_rejection_reason}. Upload new photos below.</p>
      )}

      <fieldset>
        <legend className="field-label">Document</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['national_id', 'Lebanese ID card'],
              ['passport', 'Passport'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`flex h-11 cursor-pointer items-center justify-center rounded-md border text-[15px] font-semibold ${
                docType === value ? 'border-ink bg-ink text-white' : 'border-line bg-card text-ink-soft'
              }`}
            >
              <input type="radio" name="doc" value={value} checked={docType === value} onChange={() => setDocType(value)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className={`grid gap-4 ${docType === 'national_id' ? 'sm:grid-cols-2' : ''}`}>
        <FileField id="doc-front" label={docType === 'national_id' ? 'Front' : 'Photo page'} file={front} onChange={pick(setFront)} />
        {docType === 'national_id' && <FileField id="doc-back" label="Back" file={back} onChange={pick(setBack)} />}
      </div>
      <p className="field-hint">Make sure all four corners are visible and the text is sharp. JPG, PNG, WebP or PDF, up to 10 MB each.</p>

      {error && <p className="alert-error" role="alert">{error}</p>}

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Uploading…' : 'Submit for review'}
      </button>
    </form>
  )
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 text-sm text-mist hover:text-ink"
      onClick={() => {
        void navigator.clipboard.writeText(id).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : `User ID ${id.slice(0, 8)}…`}
    </button>
  )
}

export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth()
  if (!profile) return null

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <AvatarPicker profile={profile} onChanged={refreshProfile} />
        <div className="space-y-2">
          <h1 className="text-4xl">{profile.full_name || 'Welcome'}</h1>
          <p className="flex flex-wrap justify-center gap-x-4 text-ink-soft sm:justify-start">
            {profile.phone && <span>{formatPhone(profile.phone)}</span>}
            {profile.email && <span>{profile.email}</span>}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            <VerificationBadge status={profile.kyc_status} />
            <CopyId id={profile.id} />
          </div>
        </div>
      </section>

      <IdentitySection profile={profile} onSubmitted={refreshProfile} />
      <DetailsForm profile={profile} onSaved={refreshProfile} />
    </div>
  )
}
