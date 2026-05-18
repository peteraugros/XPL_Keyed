export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      cancellation_events: {
        Row: {
          classification: string
          created_at: string
          curriculum_slot_id: string | null
          cycle_cancels_used_after: number | null
          hours_until_call: number | null
          id: string
          initiated_via: string
          subscription_id: string
          triggered_pending_cancel: boolean
          waiting_on: Database["public"]["Enums"]["waiting_on_t"]
        }
        Insert: {
          classification: string
          created_at?: string
          curriculum_slot_id?: string | null
          cycle_cancels_used_after?: number | null
          hours_until_call?: number | null
          id?: string
          initiated_via: string
          subscription_id: string
          triggered_pending_cancel?: boolean
          waiting_on?: Database["public"]["Enums"]["waiting_on_t"]
        }
        Update: {
          classification?: string
          created_at?: string
          curriculum_slot_id?: string | null
          cycle_cancels_used_after?: number | null
          hours_until_call?: number | null
          id?: string
          initiated_via?: string
          subscription_id?: string
          triggered_pending_cancel?: boolean
          waiting_on?: Database["public"]["Enums"]["waiting_on_t"]
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_events_curriculum_slot_id_fkey"
            columns: ["curriculum_slot_id"]
            isOneToOne: false
            referencedRelation: "curriculum_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_cancels: {
        Row: {
          bypassed_24hr_gate: boolean
          coach_id: string
          created_at: string
          curriculum_slot_id: string
          id: string
          reason: string
          scope: string
        }
        Insert: {
          bypassed_24hr_gate?: boolean
          coach_id: string
          created_at?: string
          curriculum_slot_id: string
          id?: string
          reason: string
          scope: string
        }
        Update: {
          bypassed_24hr_gate?: boolean
          coach_id?: string
          created_at?: string
          curriculum_slot_id?: string
          id?: string
          reason?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_cancels_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_cancels_curriculum_slot_id_fkey"
            columns: ["curriculum_slot_id"]
            isOneToOne: false
            referencedRelation: "curriculum_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      coaches: {
        Row: {
          admin_mode: string
          auth_user_id: string | null
          created_at: string
          discord_user_id: string | null
          display_name: string
          email: string
          id: string
          is_active: boolean
          stage_name: string | null
          updated_at: string
        }
        Insert: {
          admin_mode?: string
          auth_user_id?: string | null
          created_at?: string
          discord_user_id?: string | null
          display_name: string
          email: string
          id?: string
          is_active?: boolean
          stage_name?: string | null
          updated_at?: string
        }
        Update: {
          admin_mode?: string
          auth_user_id?: string | null
          created_at?: string
          discord_user_id?: string | null
          display_name?: string
          email?: string
          id?: string
          is_active?: boolean
          stage_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      curricula: {
        Row: {
          approval_token: string | null
          approved_at: string | null
          created_at: string
          created_by: string
          id: string
          personalization_note: string | null
          player_id: string
          status: string
          updated_at: string
          waiting_on: Database["public"]["Enums"]["waiting_on_t"]
        }
        Insert: {
          approval_token?: string | null
          approved_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          personalization_note?: string | null
          player_id: string
          status?: string
          updated_at?: string
          waiting_on?: Database["public"]["Enums"]["waiting_on_t"]
        }
        Update: {
          approval_token?: string | null
          approved_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          personalization_note?: string | null
          player_id?: string
          status?: string
          updated_at?: string
          waiting_on?: Database["public"]["Enums"]["waiting_on_t"]
        }
        Relationships: [
          {
            foreignKeyName: "curricula_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curricula_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      curriculum_slots: {
        Row: {
          created_at: string
          curriculum_id: string
          delivered_at: string | null
          id: string
          is_vod_review: boolean
          lesson_id: string | null
          live_call_at: string | null
          live_call_completed_at: string | null
          live_call_event_id: string | null
          no_show_at: string | null
          notified_at_20min: string | null
          updated_at: string
          vod_talking_points: Json | null
          vod_url: string | null
          week_number: number
        }
        Insert: {
          created_at?: string
          curriculum_id: string
          delivered_at?: string | null
          id?: string
          is_vod_review?: boolean
          lesson_id?: string | null
          live_call_at?: string | null
          live_call_completed_at?: string | null
          live_call_event_id?: string | null
          no_show_at?: string | null
          notified_at_20min?: string | null
          updated_at?: string
          vod_talking_points?: Json | null
          vod_url?: string | null
          week_number: number
        }
        Update: {
          created_at?: string
          curriculum_id?: string
          delivered_at?: string | null
          id?: string
          is_vod_review?: boolean
          lesson_id?: string | null
          live_call_at?: string | null
          live_call_completed_at?: string | null
          live_call_event_id?: string | null
          no_show_at?: string | null
          notified_at_20min?: string | null
          updated_at?: string
          vod_talking_points?: Json | null
          vod_url?: string | null
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_slots_curriculum_id_fkey"
            columns: ["curriculum_id"]
            isOneToOne: false
            referencedRelation: "curricula"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curriculum_slots_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string
          id: string
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lessons: {
        Row: {
          author_id: string
          created_at: string
          difficulty_level: string
          duration_minutes: number
          fortnite_label: string
          id: string
          is_published: boolean
          parent_label: string
          parent_skill_description: string
          parent_talking_points: Json
          slides: Json
          title: string
          topic: string
          updated_at: string
        }
        Insert: {
          author_id: string
          created_at?: string
          difficulty_level: string
          duration_minutes: number
          fortnite_label: string
          id?: string
          is_published?: boolean
          parent_label: string
          parent_skill_description: string
          parent_talking_points: Json
          slides: Json
          title: string
          topic: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          created_at?: string
          difficulty_level?: string
          duration_minutes?: number
          fortnite_label?: string
          id?: string
          is_published?: boolean
          parent_label?: string
          parent_skill_description?: string
          parent_talking_points?: Json
          slides?: Json
          title?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          player_id: string
          read_by_parent_at: string | null
          read_by_recipient_at: string | null
          sender_id: string | null
          sender_role: string
          waiting_on: Database["public"]["Enums"]["waiting_on_t"]
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          player_id: string
          read_by_parent_at?: string | null
          read_by_recipient_at?: string | null
          sender_id?: string | null
          sender_role: string
          waiting_on?: Database["public"]["Enums"]["waiting_on_t"]
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          player_id?: string
          read_by_parent_at?: string | null
          read_by_recipient_at?: string | null
          sender_id?: string | null
          sender_role?: string
          waiting_on?: Database["public"]["Enums"]["waiting_on_t"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      no_shows: {
        Row: {
          conversion_reason: string | null
          converted_to_credit_at: string | null
          created_at: string
          curriculum_slot_id: string
          id: string
          subscription_id: string
        }
        Insert: {
          conversion_reason?: string | null
          converted_to_credit_at?: string | null
          created_at?: string
          curriculum_slot_id: string
          id?: string
          subscription_id: string
        }
        Update: {
          conversion_reason?: string | null
          converted_to_credit_at?: string | null
          created_at?: string
          curriculum_slot_id?: string
          id?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "no_shows_curriculum_slot_id_fkey"
            columns: ["curriculum_slot_id"]
            isOneToOne: true
            referencedRelation: "curriculum_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "no_shows_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          channel: string
          created_at: string
          error_message: string | null
          id: string
          recipient_id: string | null
          recipient_type: string
          related_entity_id: string | null
          related_entity_type: string | null
          sent_at: string | null
          status: string
          trigger: string
        }
        Insert: {
          channel: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_id?: string | null
          recipient_type: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          status?: string
          trigger: string
        }
        Update: {
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_id?: string | null
          recipient_type?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          status?: string
          trigger?: string
        }
        Relationships: []
      }
      parents: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string
          email_verified_at: string | null
          family_id: string
          first_name: string
          id: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email: string
          email_verified_at?: string | null
          family_id: string
          first_name: string
          id?: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string
          email_verified_at?: string | null
          family_id?: string
          first_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parents_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_intake_verifications: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          intake_id: string
          parent_email: string
          parent_first_name: string
          token: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          intake_id: string
          parent_email: string
          parent_first_name: string
          token: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          intake_id?: string
          parent_email?: string
          parent_first_name?: string
          token?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      players: {
        Row: {
          age: number
          auth_user_id: string | null
          created_at: string
          current_rank: string | null
          discord_channel_url: string | null
          discord_username: string | null
          family_id: string
          first_name: string
          fortnite_username: string | null
          hours_per_week: number | null
          id: string
          platform: string | null
          updated_at: string
        }
        Insert: {
          age: number
          auth_user_id?: string | null
          created_at?: string
          current_rank?: string | null
          discord_channel_url?: string | null
          discord_username?: string | null
          family_id: string
          first_name: string
          fortnite_username?: string | null
          hours_per_week?: number | null
          id?: string
          platform?: string | null
          updated_at?: string
        }
        Update: {
          age?: number
          auth_user_id?: string | null
          created_at?: string
          current_rank?: string | null
          discord_channel_url?: string | null
          discord_username?: string | null
          family_id?: string
          first_name?: string
          fortnite_username?: string | null
          hours_per_week?: number | null
          id?: string
          platform?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "players_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      prep_responses: {
        Row: {
          id: string
          player_id: string
          q1_choice: string
          q1_other_text: string | null
          q2_choice: string
          q2_other_text: string | null
          q3_reflection: string
          submitted_at: string
        }
        Insert: {
          id?: string
          player_id: string
          q1_choice: string
          q1_other_text?: string | null
          q2_choice: string
          q2_other_text?: string | null
          q3_reflection: string
          submitted_at?: string
        }
        Update: {
          id?: string
          player_id?: string
          q1_choice?: string
          q1_other_text?: string | null
          q2_choice?: string
          q2_other_text?: string | null
          q3_reflection?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prep_responses_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      quest_completions: {
        Row: {
          completed_at: string
          id: string
          player_id: string
          quest_key: string
          xp_awarded: number
        }
        Insert: {
          completed_at?: string
          id?: string
          player_id: string
          quest_key: string
          xp_awarded?: number
        }
        Update: {
          completed_at?: string
          id?: string
          player_id?: string
          quest_key?: string
          xp_awarded?: number
        }
        Relationships: [
          {
            foreignKeyName: "quest_completions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      stuck_events: {
        Row: {
          created_at: string
          id: string
          object_id: string
          object_type: string
          reason: string | null
          resolution_note: string | null
          resolution_type: string | null
          resolved_at: string | null
          resolved_by: string | null
          tim_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          object_id: string
          object_type: string
          reason?: string | null
          resolution_note?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          tim_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          object_id?: string
          object_type?: string
          reason?: string | null
          resolution_note?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          tim_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stuck_events_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "parents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stuck_events_tim_user_id_fkey"
            columns: ["tim_user_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          cycle_cancels_used: number
          cycle_lessons_delivered: number
          cycle_started_at: string | null
          id: string
          last_cancel_at: string | null
          lifecycle_state: Database["public"]["Enums"]["lifecycle_state_t"]
          notified_at_day7_dunning: string | null
          notified_at_dunning_day3: string | null
          notified_at_dunning_day6: string | null
          notified_at_third_cancel: string | null
          past_due_started_at: string | null
          pending_cancel_auto_confirm_at: string | null
          pending_cancel_reminder_3day_at: string | null
          pending_cancel_reminder_6day_at: string | null
          pending_cancel_started_at: string | null
          player_id: string
          status: string
          stripe_subscription_id: string | null
          tier: string
          updated_at: string
          waiting_on: Database["public"]["Enums"]["waiting_on_t"]
        }
        Insert: {
          created_at?: string
          cycle_cancels_used?: number
          cycle_lessons_delivered?: number
          cycle_started_at?: string | null
          id?: string
          last_cancel_at?: string | null
          lifecycle_state?: Database["public"]["Enums"]["lifecycle_state_t"]
          notified_at_day7_dunning?: string | null
          notified_at_dunning_day3?: string | null
          notified_at_dunning_day6?: string | null
          notified_at_third_cancel?: string | null
          past_due_started_at?: string | null
          pending_cancel_auto_confirm_at?: string | null
          pending_cancel_reminder_3day_at?: string | null
          pending_cancel_reminder_6day_at?: string | null
          pending_cancel_started_at?: string | null
          player_id: string
          status?: string
          stripe_subscription_id?: string | null
          tier: string
          updated_at?: string
          waiting_on?: Database["public"]["Enums"]["waiting_on_t"]
        }
        Update: {
          created_at?: string
          cycle_cancels_used?: number
          cycle_lessons_delivered?: number
          cycle_started_at?: string | null
          id?: string
          last_cancel_at?: string | null
          lifecycle_state?: Database["public"]["Enums"]["lifecycle_state_t"]
          notified_at_day7_dunning?: string | null
          notified_at_dunning_day3?: string | null
          notified_at_dunning_day6?: string | null
          notified_at_third_cancel?: string | null
          past_due_started_at?: string | null
          pending_cancel_auto_confirm_at?: string | null
          pending_cancel_reminder_3day_at?: string | null
          pending_cancel_reminder_6day_at?: string | null
          pending_cancel_started_at?: string | null
          player_id?: string
          status?: string
          stripe_subscription_id?: string | null
          tier?: string
          updated_at?: string
          waiting_on?: Database["public"]["Enums"]["waiting_on_t"]
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      vod_uploads: {
        Row: {
          created_at: string
          id: string
          is_initial_trial_vod: boolean
          player_id: string
          source: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_initial_trial_vod?: boolean
          player_id: string
          source: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          is_initial_trial_vod?: boolean
          player_id?: string
          source?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "vod_uploads_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_entries: {
        Row: {
          claimed_at: string | null
          created_at: string
          expired_at: string | null
          family_id: string | null
          freshness_response: string | null
          id: string
          kid_age: number
          kid_first_name: string
          last_freshness_check_at: string | null
          offer_expires_at: string | null
          offer_token: string | null
          offered_at: string | null
          parent_email: string
          parent_first_name: string | null
          reminder_24hr_sent_at: string | null
          removed_at: string | null
          removed_reason: string | null
          status: string
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          expired_at?: string | null
          family_id?: string | null
          freshness_response?: string | null
          id?: string
          kid_age: number
          kid_first_name: string
          last_freshness_check_at?: string | null
          offer_expires_at?: string | null
          offer_token?: string | null
          offered_at?: string | null
          parent_email: string
          parent_first_name?: string | null
          reminder_24hr_sent_at?: string | null
          removed_at?: string | null
          removed_reason?: string | null
          status?: string
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          expired_at?: string | null
          family_id?: string | null
          freshness_response?: string | null
          id?: string
          kid_age?: number
          kid_first_name?: string
          last_freshness_check_at?: string | null
          offer_expires_at?: string | null
          offer_token?: string | null
          offered_at?: string | null
          parent_email?: string
          parent_first_name?: string | null
          reminder_24hr_sent_at?: string | null
          removed_at?: string | null
          removed_reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      derived_tasks_view: {
        Row: {
          age_in_state: string | null
          client_id: string | null
          client_name: string | null
          priority_score: number | null
          source_object_id: string | null
          task_payload: Json | null
          task_type: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      cron_fire: { Args: { trigger_name: string }; Returns: number }
      family_id_for_user: { Args: never; Returns: string }
      is_coach: { Args: never; Returns: boolean }
      player_id_for_user: { Args: never; Returns: string }
      rpc_intake: {
        Args: {
          p_intake_id: string
          p_kid_age: number
          p_kid_auth_user_id: string
          p_kid_current_rank: string
          p_kid_discord_username: string
          p_kid_first_name: string
          p_kid_fortnite_username: string
          p_kid_hours_per_week: number
          p_kid_platform: string
          p_parent_auth_user_id: string
          p_parent_email: string
          p_parent_first_name: string
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      lifecycle_state_t:
        | "TRIAL_PREP"
        | "TRIAL_SCHEDULED"
        | "TRIAL_DONE"
        | "ACTIVE"
        | "PAST_DUE"
        | "PENDING_CANCEL"
        | "CANCELED"
        | "WAITLIST"
      waiting_on_t: "TIM" | "PARENT" | "KID" | "SYSTEM" | "DAD"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      lifecycle_state_t: [
        "TRIAL_PREP",
        "TRIAL_SCHEDULED",
        "TRIAL_DONE",
        "ACTIVE",
        "PAST_DUE",
        "PENDING_CANCEL",
        "CANCELED",
        "WAITLIST",
      ],
      waiting_on_t: ["TIM", "PARENT", "KID", "SYSTEM", "DAD"],
    },
  },
} as const

