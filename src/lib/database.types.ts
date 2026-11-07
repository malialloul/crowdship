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
            foreignKeyName: 'escrow_transactions_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
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
      orders: {
        Row: {
          id: string
          shopper_id: string
          item_url: string | null
          title: string
          description: string | null
          image_url: string | null
          item_price: number
          quantity: number
          item_total: number
          currency: Database['public']['Enums']['escrow_currency']
          weight_kg: number
          origin_country: string
          reward_amount: number
          needed_by: string | null
          status: Database['public']['Enums']['order_status']
          traveler_id: string | null
          trip_id: string | null
          accepted_offer_id: string | null
          agreed_reward: number | null
          cancelled_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          shopper_id?: string
          item_url?: string | null
          title: string
          description?: string | null
          image_url?: string | null
          item_price: number
          quantity?: number
          currency?: Database['public']['Enums']['escrow_currency']
          weight_kg: number
          origin_country: string
          reward_amount: number
          needed_by?: string | null
          status?: Database['public']['Enums']['order_status']
          traveler_id?: string | null
          trip_id?: string | null
          accepted_offer_id?: string | null
          agreed_reward?: number | null
          cancelled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          shopper_id?: string
          item_url?: string | null
          title?: string
          description?: string | null
          image_url?: string | null
          item_price?: number
          quantity?: number
          currency?: Database['public']['Enums']['escrow_currency']
          weight_kg?: number
          origin_country?: string
          reward_amount?: number
          needed_by?: string | null
          status?: Database['public']['Enums']['order_status']
          traveler_id?: string | null
          trip_id?: string | null
          accepted_offer_id?: string | null
          agreed_reward?: number | null
          cancelled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'orders_shopper_id_fkey'
            columns: ['shopper_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'orders_traveler_id_fkey'
            columns: ['traveler_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'orders_trip_id_fkey'
            columns: ['trip_id']
            isOneToOne: false
            referencedRelation: 'trips'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'orders_accepted_offer_id_fkey'
            columns: ['accepted_offer_id']
            isOneToOne: false
            referencedRelation: 'offers'
            referencedColumns: ['id']
          },
        ]
      }
      trips: {
        Row: {
          id: string
          traveler_id: string
          origin_country: string
          origin_city: string
          destination_city: string
          travel_date: string
          capacity_kg: number
          notes: string | null
          status: Database['public']['Enums']['trip_status']
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          traveler_id?: string
          origin_country: string
          origin_city: string
          destination_city?: string
          travel_date: string
          capacity_kg: number
          notes?: string | null
          status?: Database['public']['Enums']['trip_status']
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          traveler_id?: string
          origin_country?: string
          origin_city?: string
          destination_city?: string
          travel_date?: string
          capacity_kg?: number
          notes?: string | null
          status?: Database['public']['Enums']['trip_status']
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'trips_traveler_id_fkey'
            columns: ['traveler_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      offers: {
        Row: {
          id: string
          order_id: string
          trip_id: string
          traveler_id: string
          amount: number
          awaiting: Database['public']['Enums']['offer_party']
          status: Database['public']['Enums']['offer_status']
          message: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          order_id: string
          trip_id: string
          traveler_id: string
          amount: number
          awaiting?: Database['public']['Enums']['offer_party']
          status?: Database['public']['Enums']['offer_status']
          message?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          trip_id?: string
          traveler_id?: string
          amount?: number
          awaiting?: Database['public']['Enums']['offer_party']
          status?: Database['public']['Enums']['offer_status']
          message?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'offers_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'offers_trip_id_fkey'
            columns: ['trip_id']
            isOneToOne: false
            referencedRelation: 'trips'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'offers_traveler_id_fkey'
            columns: ['traveler_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      offer_events: {
        Row: {
          id: number
          offer_id: string
          actor: Database['public']['Enums']['offer_party'] | null
          action: string
          amount: number | null
          created_at: string
        }
        Insert: {
          id?: never
          offer_id: string
          actor?: Database['public']['Enums']['offer_party'] | null
          action: string
          amount?: number | null
          created_at?: string
        }
        Update: {
          id?: never
          offer_id?: string
          actor?: Database['public']['Enums']['offer_party'] | null
          action?: string
          amount?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'offer_events_offer_id_fkey'
            columns: ['offer_id']
            isOneToOne: false
            referencedRelation: 'offers'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          kind: string
          title: string
          body: string | null
          link: string | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          kind: string
          title: string
          body?: string | null
          link?: string | null
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          kind?: string
          title?: string
          body?: string | null
          link?: string | null
          read_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
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
      is_verified: { Args: never; Returns: boolean }
      make_offer: {
        Args: { p_order_id: string; p_trip_id: string; p_amount: number; p_message?: string | null }
        Returns: string
      }
      respond_offer: {
        Args: { p_offer_id: string; p_action: 'accept' | 'counter' | 'decline' | 'withdraw'; p_amount?: number | null }
        Returns: Database['public']['Tables']['offers']['Row']
      }
      cancel_order: { Args: { p_order_id: string }; Returns: undefined }
      matching_orders: {
        Args: { p_trip_id: string }
        Returns: Database['public']['Tables']['orders']['Row'][]
      }
      public_profiles: {
        Args: { p_ids: string[] }
        Returns: { id: string; display_name: string; avatar_url: string | null; verified: boolean }[]
      }
      trip_committed_kg: { Args: { p_trip_id: string }; Returns: number }
    }
    Enums: {
      user_role: 'user' | 'admin'
      kyc_status: 'not_submitted' | 'pending' | 'verified' | 'rejected'
      kyc_document_type: 'national_id' | 'passport'
      escrow_status: 'PENDING_PAYMENT' | 'HELD' | 'RELEASED' | 'REFUNDED' | 'FAILED' | 'CANCELLED'
      escrow_currency: 'USD' | 'LBP'
      payout_status: 'queued' | 'paid' | 'failed'
      order_status: 'SEARCHING_TRAVELER' | 'AWAITING_PAYMENT_HOLD' | 'PURCHASING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED'
      trip_status: 'OPEN' | 'CLOSED' | 'CANCELLED'
      offer_status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN'
      offer_party: 'shopper' | 'traveler'
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
export type Order = Tables<'orders'>
export type Trip = Tables<'trips'>
export type Offer = Tables<'offers'>
export type OfferEvent = Tables<'offer_events'>
export type AppNotification = Tables<'notifications'>
export type OrderStatus = Enums<'order_status'>
export type PublicProfile = Database['public']['Functions']['public_profiles']['Returns'][number]
