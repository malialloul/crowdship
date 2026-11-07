import { supabase } from '../lib/supabase'
import type { KycSubmission, Profile } from '../lib/database.types'
import { AppError } from '../lib/errors'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const KYC_TYPES = [...IMAGE_TYPES, 'application/pdf']
const MB = 1024 * 1024

export async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error) throw error
  return data
}

export async function updateProfile(
  userId: string,
  patch: Pick<Partial<Profile>, 'full_name' | 'whish_phone' | 'avatar_url'>,
): Promise<void> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
  if (error) throw error
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new AppError('Use a JPG, PNG or WebP image')
  if (file.size > 5 * MB) throw new AppError('Profile pictures must be under 5 MB')

  const path = `${userId}/avatar`
  const { error } = await supabase.storage.from('avatars').upload(path, file, {
    contentType: file.type,
    upsert: true,
    cacheControl: '3600',
  })
  if (error) throw error

  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  const url = `${data.publicUrl}?v=${Date.now()}` // bust CDN cache after replacing
  await updateProfile(userId, { avatar_url: url })
  return url
}

export function validateKycFile(file: File): string | null {
  if (!KYC_TYPES.includes(file.type)) return 'Use a photo (JPG, PNG, WebP) or a PDF scan'
  if (file.size > 10 * MB) return 'Each document must be under 10 MB'
  return null
}

async function uploadKycFile(userId: string, file: File, side: 'front' | 'back'): Promise<string> {
  const problem = validateKycFile(file)
  if (problem) throw new AppError(problem)

  const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1]
  const path = `${userId}/${Date.now()}-${side}-${crypto.randomUUID().slice(0, 8)}.${ext}`
  const { error } = await supabase.storage.from('kyc-documents').upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw error
  return path
}

export async function submitKyc(
  userId: string,
  documentType: 'national_id' | 'passport',
  front: File,
  back: File | null,
): Promise<void> {
  if (documentType === 'national_id' && !back) throw new AppError('Add both sides of your ID card')

  const frontPath = await uploadKycFile(userId, front, 'front')
  const backPath = documentType === 'national_id' && back ? await uploadKycFile(userId, back, 'back') : null

  const { error } = await supabase.rpc('submit_kyc', {
    p_document_type: documentType,
    p_document_path: frontPath,
    p_document_back_path: backPath,
  })
  if (error) throw error
}

// ---------- Admin ----------

export type KycReviewItem = KycSubmission & {
  user: Pick<Profile, 'id' | 'full_name' | 'phone' | 'email' | 'avatar_url'> | null
}

export async function listKycSubmissions(status: 'pending' | 'verified' | 'rejected'): Promise<KycReviewItem[]> {
  const { data, error } = await supabase
    .from('kyc_submissions')
    .select('*, user:profiles!kyc_submissions_user_id_fkey(id, full_name, phone, email, avatar_url)')
    .eq('status', status)
    .order('created_at', { ascending: status === 'pending' })
    .limit(100)
  if (error) throw error
  return data
}

export async function signedDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('kyc-documents').createSignedUrl(path, 300)
  if (error) throw error
  return data.signedUrl
}

export async function reviewKyc(submissionId: string, approve: boolean, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('review_kyc', {
    p_submission_id: submissionId,
    p_approve: approve,
    p_reason: reason ?? null,
  })
  if (error) throw error
}
