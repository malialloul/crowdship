import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export class AppError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return 'Something went wrong'
}

/** Invokes an Edge Function and surfaces its `{ error }` body as an AppError. */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = (await error.context.json().catch(() => null)) as { error?: string; code?: string } | null
      throw new AppError(payload?.error ?? error.message, payload?.code)
    }
    throw new AppError(error.message)
  }
  return data as T
}
