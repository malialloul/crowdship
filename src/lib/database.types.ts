// Hand-written to match supabase/migrations. Regenerate once the local stack
// is running:  npm run db:types
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          phone: string | null
          email: string | null
          avatar_url: string | null
          whish_phone: string | null
          role: Database['public']['Enums']['user_role']
          kyc_status: Database['public']['Enums']['kyc_status']
          kyc_reviewed_at: string | null
          kyc_rejection_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          phone?: string | null
          email?: string | null
          avatar_url?: string | null
          whish_phone?: string | null
          role?: Database['public']['Enums']['user_role']
          kyc_status?: Database['public']['Enums']['kyc_status']
          kyc_reviewed_at?: string | null
          kyc_rejection_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          phone?: string | null
          email?: string | null
          avatar_url?: string | null
          whish_phone?: string | null
          role?: Database['public']['Enums']['user_role']
          kyc_status?: Database['public']['Enums']['kyc_status']
          kyc_reviewed_at?: string | null
          kyc_rejection_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      kyc_submissions: {
        Row: {
          id: string
          user_id: string
          document_type: Database['public']['Enums']['kyc_document_type']
          document_path: string
          document_back_path: string | null
          status: Database['public']['Enums']['kyc_status']
          reviewer_id: string | null
          reviewed_at: string | null
          rejection_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          document_type: Database['public']['Enums']['kyc_document_type']
          document_path: string
          document_back_path?: string | null
          status?: Database['public']['Enums']['kyc_status']
          reviewer_id?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          document_type?: Database['public']['Enums']['kyc_document_type']
          document_path?: string
          document_back_path?: string | null
          status?: Database['public']['Enums']['kyc_status']
          reviewer_id?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'kyc_submissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kyc_submissions_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      escrow_transactions: {
        Row: {
          id: string
          order_id: string | null
          shopper_id: string
          traveler_id: string
          item_amount: number
          reward_amount: number
          total_amount: number
          currency: Database['public']['Enums']['escrow_currency']
          status: Database['public']['Enums']['escrow_status']
          whish_external_id: number
          whish_collect_url: string | null
          payer_phone: string | null
          release_method: string | null
          held_at: string | null
          released_at: string | null
          refunded_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          order_id?: string | null
          shopper_id: string
          traveler_id: string
          item_amount: number
          reward_amount: number
          currency?: Database['public']['Enums']['escrow_currency']
          status?: Database['public']['Enums']['escrow_status']
          whish_collect_url?: string | null
          payer_phone?: string | null
          release_method?: string | null
          held_at?: string | null
          released_at?: string | null
          refunded_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          order_id?: string | null
          shopper_id?: string
          traveler_id?: string
          item_amount?: number
          reward_amount?: number
          currency?: Database['public']['Enums']['escrow_currency']
          status?: Database['public']['Enums']['escrow_status']
          whish_collect_url?: string | null
          payer_phone?: string | null
          release_method?: string | null
          held_at?: string | null
          released_at?: string | null
          refunded_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'escrow_transactions_shopper_id_fkey'
            columns: ['shopper_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'escrow_transactions_traveler_id_fkey'
            columns: ['traveler_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      escrow_events: {
        Row: {
          id: number
          escrow_id: string
          from_status: Database['public']['Enums']['escrow_status'] | null
          to_status: Database['public']['Enums']['escrow_status']
          actor_type: string
          actor_id: string | null
          reason: string | null
          payload: Json
          created_at: string
        }
        Insert: {
          id?: never
          escrow_id: string
          from_status?: Database['public']['Enums']['escrow_status'] | null
          to_status: Database['public']['Enums']['escrow_status']
          actor_type: string
          actor_id?: string | null
          reason?: string | null
          payload?: Json
          created_at?: string
        }
        Update: {
          id?: never
          escrow_id?: string
          from_status?: Database['public']['Enums']['escrow_status'] | null
          to_status?: Database['public']['Enums']['escrow_status']
          actor_type?: string
          actor_id?: string | null
          reason?: string | null
          payload?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'escrow_events_escrow_id_fkey'
            columns: ['escrow_id']
            isOneToOne: false
            referencedRelation: 'escrow_transactions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'escrow_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      payouts: {
        Row: {
          id: string
          escrow_id: string
          traveler_id: string
          amount: number
          currency: Database['public']['Enums']['escrow_currency']
          whish_phone: string | null
          status: Database['public']['Enums']['payout_status']
          provider_reference: string | null
          paid_by: string | null
          paid_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          escrow_id: string
          traveler_id: string
          amount: number
          currency: Database['public']['Enums']['escrow_currency']
          whish_phone?: string | null
          status?: Database['public']['Enums']['payout_status']
          provider_reference?: string | null
          paid_by?: string | null
          paid_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          escrow_id?: string
          traveler_id?: string
          amount?: number
          currency?: Database['public']['Enums']['escrow_currency']
          whish_phone?: string | null
          status?: Database['public']['Enums']['payout_status']
          provider_reference?: string | null
          paid_by?: string | null
          paid_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'payouts_escrow_id_fkey'
            columns: ['escrow_id']
            isOneToOne: true
            referencedRelation: 'escrow_transactions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payouts_traveler_id_fkey'
            columns: ['traveler_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payouts_paid_by_fkey'
            columns: ['paid_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      submit_kyc: {
        Args: {
          p_document_type: Database['public']['Enums']['kyc_document_type']
          p_document_path: string
          p_document_back_path?: string | null
        }
        Returns: string
      }
      review_kyc: {
        Args: { p_submission_id: string; p_approve: boolean; p_reason?: string | null }
        Returns: undefined
      }
      mark_payout_paid: {
        Args: { p_payout_id: string; p_reference: string }
        Returns: undefined
      }
    }
    Enums: {
      user_role: 'user' | 'admin'
      kyc_status: 'not_submitted' | 'pending' | 'verified' | 'rejected'
      kyc_document_type: 'national_id' | 'passport'
      escrow_status: 'PENDING_PAYMENT' | 'HELD' | 'RELEASED' | 'REFUNDED' | 'FAILED' | 'CANCELLED'
      escrow_currency: 'USD' | 'LBP'
      payout_status: 'queued' | 'paid' | 'failed'
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type PublicSchema = Database['public']
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T]

export type Profile = Tables<'profiles'>
export type KycSubmission = Tables<'kyc_submissions'>
export type Escrow = Tables<'escrow_transactions'>
export type Payout = Tables<'payouts'>
export type KycStatus = Enums<'kyc_status'>
export type EscrowStatus = Enums<'escrow_status'>
export type Currency = Enums<'escrow_currency'>
