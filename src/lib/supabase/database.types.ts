export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

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
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }
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
      communities: {
        Row: {
          city_label: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          join_policy: Database["public"]["Enums"]["community_join_policy"]
          logo_path: string | null
          name: string
          settings: NonNullable<Json>
          updated_at: string
          visibility: Database["public"]["Enums"]["community_visibility"]
        }
        ComputedFields: never
        Insert: {
          city_label?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          join_policy?: Database["public"]["Enums"]["community_join_policy"]
          logo_path?: string | null
          name: string
          settings?: NonNullable<Json>
          updated_at?: string
          visibility: Database["public"]["Enums"]["community_visibility"]
        }
        Update: {
          city_label?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          join_policy?: Database["public"]["Enums"]["community_join_policy"]
          logo_path?: string | null
          name?: string
          settings?: NonNullable<Json>
          updated_at?: string
          visibility?: Database["public"]["Enums"]["community_visibility"]
        }
        Relationships: []
      }
      community_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          community_id: string
          details: NonNullable<Json>
          entity: string
          entity_id: string
          id: string
          occurred_at: string
        }
        ComputedFields: never
        Insert: {
          action: string
          actor_user_id?: string | null
          community_id: string
          details?: NonNullable<Json>
          entity: string
          entity_id: string
          id?: string
          occurred_at?: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          community_id?: string
          details?: NonNullable<Json>
          entity?: string
          entity_id?: string
          id?: string
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_audit_log_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      community_invitations: {
        Row: {
          community_id: string
          created_at: string
          expires_at: string
          id: string
          invitee_user_id: string
          issued_by: string
          redeemed_at: string | null
          revoked_at: string | null
          token_hash: string
        }
        ComputedFields: never
        Insert: {
          community_id: string
          created_at?: string
          expires_at: string
          id?: string
          invitee_user_id: string
          issued_by?: string
          redeemed_at?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          community_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          invitee_user_id?: string
          issued_by?: string
          redeemed_at?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_invitations_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      community_invitee_directory_preferences: {
        Row: {
          created_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_invitee_directory_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "player_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      community_members: {
        Row: {
          activated_at: string | null
          added_by: string | null
          community_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["community_member_role"]
          source_match_event_id: string | null
          status: Database["public"]["Enums"]["community_membership_status"]
          user_id: string
          valid_from: string
          valid_until: string | null
        }
        ComputedFields: never
        Insert: {
          activated_at?: string | null
          added_by?: string | null
          community_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["community_member_role"]
          source_match_event_id?: string | null
          status: Database["public"]["Enums"]["community_membership_status"]
          user_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          activated_at?: string | null
          added_by?: string | null
          community_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["community_member_role"]
          source_match_event_id?: string | null
          status?: Database["public"]["Enums"]["community_membership_status"]
          user_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_members_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_members_source_match_event_id_fkey"
            columns: ["source_match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      community_notifications: {
        Row: {
          created_at: string
          id: string
          kind: string
          read_at: string | null
          recipient_user_id: string
          request_message_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          recipient_user_id: string
          request_message_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          recipient_user_id?: string
          request_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_notifications_request_message_id_fkey"
            columns: ["request_message_id"]
            isOneToOne: true
            referencedRelation: "community_request_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      community_request_messages: {
        Row: {
          body: string
          client_request_id: string
          community_id: string
          created_at: string
          id: string
          membership_id: string
          recipient_user_id: string
          sender_user_id: string
        }
        ComputedFields: never
        Insert: {
          body: string
          client_request_id: string
          community_id: string
          created_at?: string
          id?: string
          membership_id: string
          recipient_user_id: string
          sender_user_id: string
        }
        Update: {
          body?: string
          client_request_id?: string
          community_id?: string
          created_at?: string
          id?: string
          membership_id?: string
          recipient_user_id?: string
          sender_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_request_messages_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_request_messages_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "community_members"
            referencedColumns: ["id"]
          },
        ]
      }
      community_venues: {
        Row: {
          address: string | null
          archived_at: string | null
          community_id: string
          created_at: string
          created_by: string
          id: string
          maps_url: string | null
          name: string
          photo_path: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          address?: string | null
          archived_at?: string | null
          community_id: string
          created_at?: string
          created_by?: string
          id?: string
          maps_url?: string | null
          name: string
          photo_path?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          community_id?: string
          created_at?: string
          created_by?: string
          id?: string
          maps_url?: string | null
          name?: string
          photo_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_venues_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      global_player_ratings: {
        Row: {
          confirmed_competitive_game_groups: number
          display_level: number
          highest_display_level: number
          initial_display_level: number
          last_rating_at: string | null
          mu: number
          projection_revision: number
          rating_config_version: number
          rating_engine: string
          rating_engine_version: string
          reliability_percent: number
          sigma: number
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          confirmed_competitive_game_groups: number
          display_level: number
          highest_display_level: number
          initial_display_level: number
          last_rating_at?: string | null
          mu: number
          projection_revision?: number
          rating_config_version?: number
          rating_engine: string
          rating_engine_version: string
          reliability_percent: number
          sigma: number
          updated_at?: string
          user_id: string
        }
        Update: {
          confirmed_competitive_game_groups?: number
          display_level?: number
          highest_display_level?: number
          initial_display_level?: number
          last_rating_at?: string | null
          mu?: number
          projection_revision?: number
          rating_config_version?: number
          rating_engine?: string
          rating_engine_version?: string
          reliability_percent?: number
          sigma?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "global_player_ratings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "player_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      league_event_references: {
        Row: {
          first_referenced_at: string
          league_id: string
          match_event_id: string
        }
        ComputedFields: never
        Insert: {
          first_referenced_at?: string
          league_id: string
          match_event_id: string
        }
        Update: {
          first_referenced_at?: string
          league_id?: string
          match_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_event_references_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_events: {
        Row: {
          action: string
          actor_id: string | null
          community_id: string
          details: NonNullable<Json>
          id: string
          league_id: string
          occurred_at: string
          system_reason: string | null
        }
        ComputedFields: never
        Insert: {
          action: string
          actor_id?: string | null
          community_id: string
          details?: NonNullable<Json>
          id?: string
          league_id: string
          occurred_at?: string
          system_reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          community_id?: string
          details?: NonNullable<Json>
          id?: string
          league_id?: string
          occurred_at?: string
          system_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_events_league_fk"
            columns: ["league_id", "community_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id", "community_id"]
          },
        ]
      }
      league_player_counters: {
        Row: {
          community_id: string
          draws: number
          league_id: string
          losses: number
          matches: number
          set_differential: number | null
          sets_lost: number
          sets_won: number
          updated_at: string
          user_id: string
          wins: number
        }
        ComputedFields: never
        Insert: {
          community_id: string
          draws?: number
          league_id: string
          losses?: number
          matches?: number
          set_differential?: never
          sets_lost?: number
          sets_won?: number
          updated_at?: string
          user_id: string
          wins?: number
        }
        Update: {
          community_id?: string
          draws?: number
          league_id?: string
          losses?: number
          matches?: number
          set_differential?: never
          sets_lost?: number
          sets_won?: number
          updated_at?: string
          user_id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_player_counters_league_fk"
            columns: ["league_id", "community_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id", "community_id"]
          },
        ]
      }
      league_process_attempts: {
        Row: {
          attempted_at: string
          community_id: string
        }
        ComputedFields: never
        Insert: {
          attempted_at: string
          community_id: string
        }
        Update: {
          attempted_at?: string
          community_id?: string
        }
        Relationships: []
      }
      league_projection_confirmations: {
        Row: {
          community_id: string
          confirmation_id: string
          group_number: number
          id: string
          league_id: string
          match_event_id: string
          projected_at: string
          proposal_id: string
          proposal_version: number
          source_confirmed_at: string
        }
        ComputedFields: never
        Insert: {
          community_id: string
          confirmation_id: string
          group_number: number
          id?: string
          league_id: string
          match_event_id: string
          projected_at?: string
          proposal_id: string
          proposal_version: number
          source_confirmed_at: string
        }
        Update: {
          community_id?: string
          confirmation_id?: string
          group_number?: number
          id?: string
          league_id?: string
          match_event_id?: string
          projected_at?: string
          proposal_id?: string
          proposal_version?: number
          source_confirmed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_projection_confirmations_confirmation_id_fkey"
            columns: ["confirmation_id"]
            isOneToOne: false
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_projection_confirmations_league_fk"
            columns: ["league_id", "community_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id", "community_id"]
          },
        ]
      }
      league_standings_snapshots: {
        Row: {
          amendment_id: string | null
          basis: string
          cause: string
          community_id: string
          effective_end_at: string
          entries: NonNullable<Json>
          generated_at: string
          included_confirmation_ids: string[]
          league_id: string
          minimum_matches_for_final_award: number
          period_start_at: string
          prior_standings_version: number | null
          repair_job_id: string | null
          source_fingerprint: string | null
          standings_version: number
          triggering_confirmation_id: string | null
        }
        ComputedFields: never
        Insert: {
          amendment_id?: string | null
          basis: string
          cause: string
          community_id: string
          effective_end_at: string
          entries: NonNullable<Json>
          generated_at?: string
          included_confirmation_ids: string[]
          league_id: string
          minimum_matches_for_final_award: number
          period_start_at: string
          prior_standings_version?: number | null
          repair_job_id?: string | null
          source_fingerprint?: string | null
          standings_version: number
          triggering_confirmation_id?: string | null
        }
        Update: {
          amendment_id?: string | null
          basis?: string
          cause?: string
          community_id?: string
          effective_end_at?: string
          entries?: NonNullable<Json>
          generated_at?: string
          included_confirmation_ids?: string[]
          league_id?: string
          minimum_matches_for_final_award?: number
          period_start_at?: string
          prior_standings_version?: number | null
          repair_job_id?: string | null
          source_fingerprint?: string | null
          standings_version?: number
          triggering_confirmation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_standings_snapshots_amendment_id_fkey"
            columns: ["amendment_id"]
            isOneToOne: false
            referencedRelation: "result_amendment_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_standings_snapshots_league_fk"
            columns: ["league_id", "community_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id", "community_id"]
          },
          {
            foreignKeyName: "league_standings_snapshots_prior_fk"
            columns: ["league_id", "prior_standings_version"]
            isOneToOne: false
            referencedRelation: "league_standings_snapshots"
            referencedColumns: ["league_id", "standings_version"]
          },
          {
            foreignKeyName: "league_standings_snapshots_repair_job_id_fkey"
            columns: ["repair_job_id"]
            isOneToOne: false
            referencedRelation: "result_repair_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_standings_snapshots_triggering_confirmation_id_fkey"
            columns: ["triggering_confirmation_id"]
            isOneToOne: false
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          activated_at: string | null
          activation_blocked_at: string | null
          closed_at: string | null
          closed_by: string | null
          closed_reason: string | null
          community_id: string
          create_input: NonNullable<Json>
          create_request_id: string
          created_at: string
          description: string | null
          end_at: string | null
          end_mode: Database["public"]["Enums"]["league_end_mode"]
          id: string
          minimum_matches_for_final_award: number
          name: string
          owner_id: string
          start_at: string
          status: Database["public"]["Enums"]["league_status"]
          timezone: string
          updated_at: string
          version: number
          league_dto: Json | null
        }
        ComputedFields: "league_dto"
        Insert: {
          activated_at?: string | null
          activation_blocked_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_reason?: string | null
          community_id: string
          create_input: NonNullable<Json>
          create_request_id: string
          created_at?: string
          description?: string | null
          end_at?: string | null
          end_mode: Database["public"]["Enums"]["league_end_mode"]
          id?: string
          minimum_matches_for_final_award?: number
          name: string
          owner_id: string
          start_at: string
          status: Database["public"]["Enums"]["league_status"]
          timezone: string
          updated_at?: string
          version?: number
        }
        Update: {
          activated_at?: string | null
          activation_blocked_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_reason?: string | null
          community_id?: string
          create_input?: NonNullable<Json>
          create_request_id?: string
          created_at?: string
          description?: string | null
          end_at?: string | null
          end_mode?: Database["public"]["Enums"]["league_end_mode"]
          id?: string
          minimum_matches_for_final_award?: number
          name?: string
          owner_id?: string
          start_at?: string
          status?: Database["public"]["Enums"]["league_status"]
          timezone?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "leagues_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      match_event_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after_data: NonNullable<Json>
          before_data: NonNullable<Json>
          changed_fields: string[]
          community_id: string
          confirmation_id: string | null
          event_version: number | null
          id: string
          match_event_id: string
          occurred_at: string
          reason: string | null
          request_id: string | null
          target_user_id: string | null
          transition_revision: number
        }
        ComputedFields: never
        Insert: {
          action: string
          actor_id?: string | null
          after_data?: NonNullable<Json>
          before_data?: NonNullable<Json>
          changed_fields?: string[]
          community_id: string
          confirmation_id?: string | null
          event_version?: number | null
          id?: string
          match_event_id: string
          occurred_at?: string
          reason?: string | null
          request_id?: string | null
          target_user_id?: string | null
          transition_revision: number
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_data?: NonNullable<Json>
          before_data?: NonNullable<Json>
          changed_fields?: string[]
          community_id?: string
          confirmation_id?: string | null
          event_version?: number | null
          id?: string
          match_event_id?: string
          occurred_at?: string
          reason?: string | null
          request_id?: string | null
          target_user_id?: string | null
          transition_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_event_audit_log_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_event_audit_log_confirmation_fk"
            columns: ["confirmation_id"]
            isOneToOne: true
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_event_audit_log_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_event_invites: {
        Row: {
          created_at: string
          expired_at: string | null
          id: string
          invited_by: string
          invitee_user_id: string
          match_event_id: string
          responded_at: string | null
          responded_by: string | null
          status: Database["public"]["Enums"]["match_invitation_status"]
          submission_result: Json | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          expired_at?: string | null
          id?: string
          invited_by: string
          invitee_user_id: string
          match_event_id: string
          responded_at?: string | null
          responded_by?: string | null
          status?: Database["public"]["Enums"]["match_invitation_status"]
          submission_result?: Json | null
        }
        Update: {
          created_at?: string
          expired_at?: string | null
          id?: string
          invited_by?: string
          invitee_user_id?: string
          match_event_id?: string
          responded_at?: string | null
          responded_by?: string | null
          status?: Database["public"]["Enums"]["match_invitation_status"]
          submission_result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "match_event_invites_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_event_management_commands: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          match_event_id: string
          payload: NonNullable<Json>
          request_id: string
          result: NonNullable<Json>
        }
        ComputedFields: never
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          match_event_id: string
          payload: NonNullable<Json>
          request_id: string
          result: NonNullable<Json>
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          match_event_id?: string
          payload?: NonNullable<Json>
          request_id?: string
          result?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "match_event_management_commands_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_event_registration_attempts: {
        Row: {
          accepted_at: string | null
          accepted_order: number | null
          actor_id: string | null
          approved_at: string | null
          confirmed_generation: number
          decided_at: string | null
          end_kind: string | null
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          match_event_id: string
          outcome: Database["public"]["Enums"]["match_registration_lifecycle"]
          reconfirmed_at: string | null
          registration_id: string
          registration_source: Database["public"]["Enums"]["match_registration_source"]
          requested_at: string
          required_generation: number
          user_id: string
        }
        ComputedFields: never
        Insert: {
          accepted_at?: string | null
          accepted_order?: number | null
          actor_id?: string | null
          approved_at?: string | null
          confirmed_generation?: number
          decided_at?: string | null
          end_kind?: string | null
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          match_event_id: string
          outcome: Database["public"]["Enums"]["match_registration_lifecycle"]
          reconfirmed_at?: string | null
          registration_id: string
          registration_source: Database["public"]["Enums"]["match_registration_source"]
          requested_at: string
          required_generation?: number
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_order?: number | null
          actor_id?: string | null
          approved_at?: string | null
          confirmed_generation?: number
          decided_at?: string | null
          end_kind?: string | null
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          match_event_id?: string
          outcome?: Database["public"]["Enums"]["match_registration_lifecycle"]
          reconfirmed_at?: string | null
          registration_id?: string
          registration_source?: Database["public"]["Enums"]["match_registration_source"]
          requested_at?: string
          required_generation?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_event_registration_attempts_match_event_id_user_id_fkey"
            columns: ["match_event_id", "user_id"]
            isOneToOne: false
            referencedRelation: "match_event_registrations"
            referencedColumns: ["match_event_id", "user_id"]
          },
          {
            foreignKeyName: "match_event_registration_attempts_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "match_event_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      match_event_registration_state: {
        Row: {
          cutoff_attempt_count: number
          cutoff_failure_count: number
          cutoff_last_attempt_at: string | null
          cutoff_last_failure_at: string | null
          cutoff_last_failure_message: string | null
          cutoff_last_failure_sqlstate: string | null
          cutoff_processed_at: string | null
          match_event_id: string
          next_accepted_ordinal: number
          results_protected_at: string | null
          transition_revision: number
        }
        ComputedFields: never
        Insert: {
          cutoff_attempt_count?: number
          cutoff_failure_count?: number
          cutoff_last_attempt_at?: string | null
          cutoff_last_failure_at?: string | null
          cutoff_last_failure_message?: string | null
          cutoff_last_failure_sqlstate?: string | null
          cutoff_processed_at?: string | null
          match_event_id: string
          next_accepted_ordinal: number
          results_protected_at?: string | null
          transition_revision?: number
        }
        Update: {
          cutoff_attempt_count?: number
          cutoff_failure_count?: number
          cutoff_last_attempt_at?: string | null
          cutoff_last_failure_at?: string | null
          cutoff_last_failure_message?: string | null
          cutoff_last_failure_sqlstate?: string | null
          cutoff_processed_at?: string | null
          match_event_id?: string
          next_accepted_ordinal?: number
          results_protected_at?: string | null
          transition_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_event_registration_state_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: true
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_event_registrations: {
        Row: {
          accepted_at: string | null
          accepted_order: number | null
          approved_at: string | null
          cancelled_at: string | null
          confirmed_generation: number
          current_attempt_id: string | null
          id: string
          left_at: string | null
          lifecycle: Database["public"]["Enums"]["match_registration_lifecycle"]
          match_event_id: string
          participation_status:
            | Database["public"]["Enums"]["match_registration_participation"]
            | null
          reconfirmed_at: string | null
          registration_source: Database["public"]["Enums"]["match_registration_source"]
          removal_reason: string | null
          removed_by: string | null
          requested_at: string | null
          required_generation: number
          resolved_at: string | null
          resolved_by: string | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          accepted_at?: string | null
          accepted_order?: number | null
          approved_at?: string | null
          cancelled_at?: string | null
          confirmed_generation?: number
          current_attempt_id?: string | null
          id?: string
          left_at?: string | null
          lifecycle?: Database["public"]["Enums"]["match_registration_lifecycle"]
          match_event_id: string
          participation_status?:
            | Database["public"]["Enums"]["match_registration_participation"]
            | null
          reconfirmed_at?: string | null
          registration_source: Database["public"]["Enums"]["match_registration_source"]
          removal_reason?: string | null
          removed_by?: string | null
          requested_at?: string | null
          required_generation?: number
          resolved_at?: string | null
          resolved_by?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_order?: number | null
          approved_at?: string | null
          cancelled_at?: string | null
          confirmed_generation?: number
          current_attempt_id?: string | null
          id?: string
          left_at?: string | null
          lifecycle?: Database["public"]["Enums"]["match_registration_lifecycle"]
          match_event_id?: string
          participation_status?:
            | Database["public"]["Enums"]["match_registration_participation"]
            | null
          reconfirmed_at?: string | null
          registration_source?: Database["public"]["Enums"]["match_registration_source"]
          removal_reason?: string | null
          removed_by?: string | null
          requested_at?: string | null
          required_generation?: number
          resolved_at?: string | null
          resolved_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_event_registrations_current_attempt_id_fkey"
            columns: ["current_attempt_id"]
            isOneToOne: false
            referencedRelation: "match_event_registration_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_event_registrations_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_event_result_confirmations: {
        Row: {
          actor_id: string | null
          confirmed_at: string
          effective_at: string
          event_type: Database["public"]["Enums"]["match_event_type"]
          group_number: number
          id: string
          match_event_id: string
          proposal_id: string
          proposal_version: number
          ratable_eligible: boolean
          source: string
          result_repair_guard_confirmation: {
            actor_id: string | null
            confirmed_at: string
            effective_at: string
            event_type: Database["public"]["Enums"]["match_event_type"]
            group_number: number
            id: string
            match_event_id: string
            proposal_id: string
            proposal_version: number
            ratable_eligible: boolean
            source: string
          } | null
        }
        ComputedFields: "result_repair_guard_confirmation"
        Insert: {
          actor_id?: string | null
          confirmed_at?: string
          effective_at: string
          event_type: Database["public"]["Enums"]["match_event_type"]
          group_number: number
          id?: string
          match_event_id: string
          proposal_id: string
          proposal_version: number
          ratable_eligible: boolean
          source: string
        }
        Update: {
          actor_id?: string | null
          confirmed_at?: string
          effective_at?: string
          event_type?: Database["public"]["Enums"]["match_event_type"]
          group_number?: number
          id?: string
          match_event_id?: string
          proposal_id?: string
          proposal_version?: number
          ratable_eligible?: boolean
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_result_confirmation_pointer_fk"
            columns: ["proposal_id", "match_event_id", "group_number"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposals"
            referencedColumns: ["id", "match_event_id", "group_number"]
          },
          {
            foreignKeyName: "match_result_confirmation_version_fk"
            columns: ["proposal_id", "proposal_version"]
            isOneToOne: true
            referencedRelation: "match_event_result_proposal_versions"
            referencedColumns: ["proposal_id", "version"]
          },
        ]
      }
      match_event_result_entry_ready_dispatch: {
        Row: {
          creator_user_id: string
          dispatched_at: string
          match_event_id: string
          notification_id: string
        }
        ComputedFields: never
        Insert: {
          creator_user_id: string
          dispatched_at?: string
          match_event_id: string
          notification_id: string
        }
        Update: {
          creator_user_id?: string
          dispatched_at?: string
          match_event_id?: string
          notification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_event_result_entry_ready_dispatch_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: true
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_event_result_entry_ready_dispatch_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: true
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      match_event_result_official_state: {
        Row: {
          current_confirmation_id: string | null
          current_version: number | null
          group_number: number
          is_void: boolean
          match_event_id: string
          official_revision: number
          proposal_id: string
          selected_at: string
          void_decision_id: string | null
        }
        ComputedFields: never
        Insert: {
          current_confirmation_id?: string | null
          current_version?: number | null
          group_number: number
          is_void?: boolean
          match_event_id: string
          official_revision?: number
          proposal_id: string
          selected_at?: string
          void_decision_id?: string | null
        }
        Update: {
          current_confirmation_id?: string | null
          current_version?: number | null
          group_number?: number
          is_void?: boolean
          match_event_id?: string
          official_revision?: number
          proposal_id?: string
          selected_at?: string
          void_decision_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "official_state_confirmation_fk"
            columns: ["current_confirmation_id", "proposal_id", "current_version"]
            isOneToOne: false
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id", "proposal_id", "proposal_version"]
          },
          {
            foreignKeyName: "official_state_proposal_fk"
            columns: ["proposal_id", "match_event_id", "group_number"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposals"
            referencedColumns: ["id", "match_event_id", "group_number"]
          },
          {
            foreignKeyName: "official_state_void_decision_fk"
            columns: ["void_decision_id"]
            isOneToOne: false
            referencedRelation: "result_dispute_resolutions"
            referencedColumns: ["id"]
          },
        ]
      }
      match_event_result_processing_state: {
        Row: {
          attempt_count: number
          attempted_at: string | null
          failure_count: number
          last_failure_at: string | null
          last_failure_code: string | null
          last_failure_message: string | null
          next_attempt_at: string | null
          proposal_id: string
          proposal_version: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          attempt_count?: number
          attempted_at?: string | null
          failure_count?: number
          last_failure_at?: string | null
          last_failure_code?: string | null
          last_failure_message?: string | null
          next_attempt_at?: string | null
          proposal_id: string
          proposal_version?: number
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          attempted_at?: string | null
          failure_count?: number
          last_failure_at?: string | null
          last_failure_code?: string | null
          last_failure_message?: string | null
          next_attempt_at?: string | null
          proposal_id?: string
          proposal_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_event_result_processing_state_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: true
            referencedRelation: "match_event_result_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_result_processing_version_fk"
            columns: ["proposal_id", "proposal_version"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposal_versions"
            referencedColumns: ["proposal_id", "version"]
          },
        ]
      }
      match_event_result_proposal_versions: {
        Row: {
          classification: string
          court_label: string | null
          played_at_local: string
          played_at_offset_seconds: number
          played_at_utc: string
          proposal_id: string
          review_deadline_at: string
          sets: NonNullable<Json>
          submitted_at: string
          submitted_by: string
          teams: NonNullable<Json>
          version: number
        }
        ComputedFields: never
        Insert: {
          classification: string
          court_label?: string | null
          played_at_local: string
          played_at_offset_seconds: number
          played_at_utc: string
          proposal_id: string
          review_deadline_at: string
          sets: NonNullable<Json>
          submitted_at: string
          submitted_by: string
          teams: NonNullable<Json>
          version: number
        }
        Update: {
          classification?: string
          court_label?: string | null
          played_at_local?: string
          played_at_offset_seconds?: number
          played_at_utc?: string
          proposal_id?: string
          review_deadline_at?: string
          sets?: NonNullable<Json>
          submitted_at?: string
          submitted_by?: string
          teams?: NonNullable<Json>
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_event_result_proposal_versions_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      match_event_result_proposals: {
        Row: {
          active_version: number
          group_number: number
          id: string
          match_event_id: string
          review_deadline_at: string
          status: string
          submitted_at: string
          submitted_by: string
        }
        ComputedFields: never
        Insert: {
          active_version: number
          group_number: number
          id?: string
          match_event_id: string
          review_deadline_at: string
          status: string
          submitted_at?: string
          submitted_by: string
        }
        Update: {
          active_version?: number
          group_number?: number
          id?: string
          match_event_id?: string
          review_deadline_at?: string
          status?: string
          submitted_at?: string
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_event_result_proposals_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_result_proposal_active_version_fk"
            columns: ["id", "active_version"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposal_versions"
            referencedColumns: ["proposal_id", "version"]
          },
        ]
      }
      match_event_result_reviews: {
        Row: {
          decided_at: string
          decision: string
          id: string
          proposal_id: string
          proposal_version: number
          reason_code: string | null
          reason_note: string | null
          request_id: string
          reviewer_user_id: string
        }
        ComputedFields: never
        Insert: {
          decided_at?: string
          decision: string
          id?: string
          proposal_id: string
          proposal_version: number
          reason_code?: string | null
          reason_note?: string | null
          request_id: string
          reviewer_user_id: string
        }
        Update: {
          decided_at?: string
          decision?: string
          id?: string
          proposal_id?: string
          proposal_version?: number
          reason_code?: string | null
          reason_note?: string | null
          request_id?: string
          reviewer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_result_review_version_fk"
            columns: ["proposal_id", "proposal_version"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposal_versions"
            referencedColumns: ["proposal_id", "version"]
          },
        ]
      }
      match_events: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          community_id: string
          court_booked: boolean
          court_notes: string | null
          created_at: string
          created_by: string
          currency: string | null
          duration_minutes: number | null
          event_type: Database["public"]["Enums"]["match_event_type"]
          id: string
          league_id: string | null
          maps_url: string
          max_level: number | null
          maximum_registrations: number | null
          min_level: number | null
          notes: string | null
          payment_note: string | null
          photo_path: string
          price_minor: number | null
          published_at: string
          published_by: string
          reconfirmation_generation: number
          registration_cutoff_at: string
          restriction_enabled: boolean
          saved_venue_id: string | null
          starts_at: string
          status: string
          team_assignment_mode: Database["public"]["Enums"]["match_team_assignment_mode"]
          timezone: string
          updated_at: string
          venue_name: string
          version: number
          visibility: Database["public"]["Enums"]["match_event_visibility"]
        }
        ComputedFields: never
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          community_id: string
          court_booked?: boolean
          court_notes?: string | null
          created_at?: string
          created_by: string
          currency?: string | null
          duration_minutes?: number | null
          event_type: Database["public"]["Enums"]["match_event_type"]
          id: string
          league_id?: string | null
          maps_url: string
          max_level?: number | null
          maximum_registrations?: number | null
          min_level?: number | null
          notes?: string | null
          payment_note?: string | null
          photo_path: string
          price_minor?: number | null
          published_at?: string
          published_by: string
          reconfirmation_generation?: number
          registration_cutoff_at: string
          restriction_enabled?: boolean
          saved_venue_id?: string | null
          starts_at: string
          status?: string
          team_assignment_mode: Database["public"]["Enums"]["match_team_assignment_mode"]
          timezone: string
          updated_at?: string
          venue_name: string
          version?: number
          visibility: Database["public"]["Enums"]["match_event_visibility"]
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          community_id?: string
          court_booked?: boolean
          court_notes?: string | null
          created_at?: string
          created_by?: string
          currency?: string | null
          duration_minutes?: number | null
          event_type?: Database["public"]["Enums"]["match_event_type"]
          id?: string
          league_id?: string | null
          maps_url?: string
          max_level?: number | null
          maximum_registrations?: number | null
          min_level?: number | null
          notes?: string | null
          payment_note?: string | null
          photo_path?: string
          price_minor?: number | null
          published_at?: string
          published_by?: string
          reconfirmation_generation?: number
          registration_cutoff_at?: string
          restriction_enabled?: boolean
          saved_venue_id?: string | null
          starts_at?: string
          status?: string
          team_assignment_mode?: Database["public"]["Enums"]["match_team_assignment_mode"]
          timezone?: string
          updated_at?: string
          venue_name?: string
          version?: number
          visibility?: Database["public"]["Enums"]["match_event_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "match_events_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_league_fk"
            columns: ["league_id", "community_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id", "community_id"]
          },
          {
            foreignKeyName: "match_events_saved_venue_id_fkey"
            columns: ["saved_venue_id"]
            isOneToOne: false
            referencedRelation: "community_venues"
            referencedColumns: ["id"]
          },
        ]
      }
      match_player_add_actor_windows: {
        Row: {
          actor_id: string
          add_count: number
          window_start: string
        }
        ComputedFields: never
        Insert: {
          actor_id: string
          add_count: number
          window_start: string
        }
        Update: {
          actor_id?: string
          add_count?: number
          window_start?: string
        }
        Relationships: []
      }
      match_player_add_operations: {
        Row: {
          actor_id: string
          branch: string | null
          capability_expires_at: string | null
          capability_hash: string | null
          completed_at: string | null
          created_at: string
          dispatch_attempt: string | null
          dispatch_attempts: number
          dispatch_state: string
          dispatched_at: string | null
          display_name: string
          email: string
          email_eligible: boolean
          estimated_level: number
          fingerprint: string
          id: string
          locale: string
          match_event_id: string
          outcome: string | null
          request_id: string
          retry_after: string
          state: string
          target_user_id: string | null
        }
        ComputedFields: never
        Insert: {
          actor_id: string
          branch?: string | null
          capability_expires_at?: string | null
          capability_hash?: string | null
          completed_at?: string | null
          created_at?: string
          dispatch_attempt?: string | null
          dispatch_attempts?: number
          dispatch_state?: string
          dispatched_at?: string | null
          display_name: string
          email: string
          email_eligible?: boolean
          estimated_level: number
          fingerprint: string
          id?: string
          locale: string
          match_event_id: string
          outcome?: string | null
          request_id: string
          retry_after?: string
          state?: string
          target_user_id?: string | null
        }
        Update: {
          actor_id?: string
          branch?: string | null
          capability_expires_at?: string | null
          capability_hash?: string | null
          completed_at?: string | null
          created_at?: string
          dispatch_attempt?: string | null
          dispatch_attempts?: number
          dispatch_state?: string
          dispatched_at?: string | null
          display_name?: string
          email?: string
          email_eligible?: boolean
          estimated_level?: number
          fingerprint?: string
          id?: string
          locale?: string
          match_event_id?: string
          outcome?: string | null
          request_id?: string
          retry_after?: string
          state?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_player_add_operations_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_player_add_recipient_sends: {
        Row: {
          email_digest: string
          operation_id: string
          sent_at: string
        }
        ComputedFields: never
        Insert: {
          email_digest: string
          operation_id: string
          sent_at: string
        }
        Update: {
          email_digest?: string
          operation_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_player_add_recipient_sends_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "match_player_add_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      match_player_add_throttle_hits: {
        Row: {
          actor_id: string
          email_digest: string | null
          id: string
          match_event_id: string
          occurred_at: string
          request_id: string
          scope: string
        }
        ComputedFields: never
        Insert: {
          actor_id: string
          email_digest?: string | null
          id?: string
          match_event_id: string
          occurred_at?: string
          request_id: string
          scope: string
        }
        Update: {
          actor_id?: string
          email_digest?: string | null
          id?: string
          match_event_id?: string
          occurred_at?: string
          request_id?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_player_add_throttle_hits_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_result_alert_deadline_queue: {
        Row: {
          active: boolean
          due_at: string
          effective_key: string | null
          enqueued_at: string
          next_attempt_at: string | null
          proposal_id: string
          proposal_version: number
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          due_at: string
          effective_key?: never
          enqueued_at?: string
          next_attempt_at?: string | null
          proposal_id: string
          proposal_version: number
        }
        Update: {
          active?: boolean
          due_at?: string
          effective_key?: never
          enqueued_at?: string
          next_attempt_at?: string | null
          proposal_id?: string
          proposal_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_result_alert_deadline_queue_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      match_result_alert_entry_ready_queue: {
        Row: {
          active: boolean
          due_at: string
          effective_key: string | null
          enqueued_at: string
          match_event_id: string
          next_attempt_at: string | null
          roster_revision: number
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          due_at: string
          effective_key?: never
          enqueued_at?: string
          match_event_id: string
          next_attempt_at?: string | null
          roster_revision?: number
        }
        Update: {
          active?: boolean
          due_at?: string
          effective_key?: never
          enqueued_at?: string
          match_event_id?: string
          next_attempt_at?: string | null
          roster_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_result_alert_entry_ready_queue_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: true
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_result_alert_processing_state: {
        Row: {
          alert_kind: string
          attempt_count: number
          attempted_at: string | null
          candidate_id: string
          candidate_version: number
          failure_count: number
          last_failure_code: string | null
          last_failure_message: string | null
          next_attempt_at: string | null
          roster_fingerprint: string | null
          terminal_outcome: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          alert_kind: string
          attempt_count?: number
          attempted_at?: string | null
          candidate_id: string
          candidate_version?: number
          failure_count?: number
          last_failure_code?: string | null
          last_failure_message?: string | null
          next_attempt_at?: string | null
          roster_fingerprint?: string | null
          terminal_outcome?: string | null
          updated_at?: string
        }
        Update: {
          alert_kind?: string
          attempt_count?: number
          attempted_at?: string | null
          candidate_id?: string
          candidate_version?: number
          failure_count?: number
          last_failure_code?: string | null
          last_failure_message?: string | null
          next_attempt_at?: string | null
          roster_fingerprint?: string | null
          terminal_outcome?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      match_result_alert_retry_fallback: {
        Row: {
          alert_kind: string
          attempt_count: number
          candidate_id: string
          candidate_version: number
          failure_count: number
          last_failure_code: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          alert_kind: string
          attempt_count?: number
          candidate_id: string
          candidate_version?: number
          failure_count?: number
          last_failure_code?: string | null
          updated_at?: string
        }
        Update: {
          alert_kind?: string
          attempt_count?: number
          candidate_id?: string
          candidate_version?: number
          failure_count?: number
          last_failure_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      match_result_alert_scan_state: {
        Row: {
          alert_kind: string
          resume_candidate_id: string | null
          resume_candidate_version: number
          resume_effective_key: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          alert_kind: string
          resume_candidate_id?: string | null
          resume_candidate_version?: number
          resume_effective_key?: string | null
          updated_at?: string
        }
        Update: {
          alert_kind?: string
          resume_candidate_id?: string | null
          resume_candidate_version?: number
          resume_effective_key?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      match_result_alert_test_clock: {
        Row: {
          frozen_at: string
          singleton: boolean
        }
        ComputedFields: never
        Insert: {
          frozen_at: string
          singleton?: boolean
        }
        Update: {
          frozen_at?: string
          singleton?: boolean
        }
        Relationships: []
      }
      notes: {
        Row: {
          body: string
          created_at: string
          id: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          body: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          critical_in_app_enabled: boolean
          push_community: boolean
          push_enabled: boolean
          push_leagues: boolean
          push_matches: boolean
          push_rankings: boolean
          push_results: boolean
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          critical_in_app_enabled?: boolean
          push_community?: boolean
          push_enabled?: boolean
          push_leagues?: boolean
          push_matches?: boolean
          push_rankings?: boolean
          push_results?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          critical_in_app_enabled?: boolean
          push_community?: boolean
          push_enabled?: boolean
          push_leagues?: boolean
          push_matches?: boolean
          push_rankings?: boolean
          push_results?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_result_links: {
        Row: {
          confirmation_id: string | null
          match_event_id: string
          notification_id: string
          proposal_id: string
          proposal_version: number
        }
        ComputedFields: never
        Insert: {
          confirmation_id?: string | null
          match_event_id: string
          notification_id: string
          proposal_id: string
          proposal_version: number
        }
        Update: {
          confirmation_id?: string | null
          match_event_id?: string
          notification_id?: string
          proposal_id?: string
          proposal_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "notification_result_link_confirmation_fk"
            columns: ["confirmation_id", "proposal_id", "proposal_version"]
            isOneToOne: false
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id", "proposal_id", "proposal_version"]
          },
          {
            foreignKeyName: "notification_result_link_version_fk"
            columns: ["proposal_id", "proposal_version"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposal_versions"
            referencedColumns: ["proposal_id", "version"]
          },
          {
            foreignKeyName: "notification_result_links_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_result_links_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: true
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          category: string
          community_id: string | null
          created_at: string
          event_key: string
          id: string
          kind: string
          read_at: string | null
          recipient_user_id: string
          sequence: number
          target_id: string
          target_type: string
        }
        ComputedFields: never
        Insert: {
          category: string
          community_id?: string | null
          created_at?: string
          event_key: string
          id?: string
          kind: string
          read_at?: string | null
          recipient_user_id: string
          sequence?: never
          target_id: string
          target_type: string
        }
        Update: {
          category?: string
          community_id?: string | null
          created_at?: string
          event_key?: string
          id?: string
          kind?: string
          read_at?: string | null
          recipient_user_id?: string
          sequence?: never
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          granted_at: string
          granted_by: string | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          granted_at?: string
          granted_by?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      player_level_review_requests: {
        Row: {
          adjustment_id: string | null
          approved_level: number | null
          canceled_at: string | null
          command_id: string
          created_at: string
          decided_at: string | null
          decision_actor_id: string | null
          decision_command_id: string | null
          decision_fingerprint: string | null
          decision_note: string | null
          evidence: string | null
          fingerprint: string
          id: string
          owner_id: string
          reason: string
          requested_max_level: number
          requested_min_level: number
          snapshot_display_level: number
          snapshot_rating_revision: number
          snapshot_reliability_percent: number
          status: Database["public"]["Enums"]["level_review_status"]
          under_review_at: string | null
          under_review_by: string | null
          level_review_admin_dto: Json | null
          level_review_owner_dto: Json | null
          level_review_queue_item_dto: Json | null
        }
        ComputedFields:
          | "level_review_admin_dto"
          | "level_review_owner_dto"
          | "level_review_queue_item_dto"
        Insert: {
          adjustment_id?: string | null
          approved_level?: number | null
          canceled_at?: string | null
          command_id: string
          created_at?: string
          decided_at?: string | null
          decision_actor_id?: string | null
          decision_command_id?: string | null
          decision_fingerprint?: string | null
          decision_note?: string | null
          evidence?: string | null
          fingerprint: string
          id?: string
          owner_id: string
          reason: string
          requested_max_level: number
          requested_min_level: number
          snapshot_display_level: number
          snapshot_rating_revision: number
          snapshot_reliability_percent: number
          status?: Database["public"]["Enums"]["level_review_status"]
          under_review_at?: string | null
          under_review_by?: string | null
        }
        Update: {
          adjustment_id?: string | null
          approved_level?: number | null
          canceled_at?: string | null
          command_id?: string
          created_at?: string
          decided_at?: string | null
          decision_actor_id?: string | null
          decision_command_id?: string | null
          decision_fingerprint?: string | null
          decision_note?: string | null
          evidence?: string | null
          fingerprint?: string
          id?: string
          owner_id?: string
          reason?: string
          requested_max_level?: number
          requested_min_level?: number
          snapshot_display_level?: number
          snapshot_rating_revision?: number
          snapshot_reliability_percent?: number
          status?: Database["public"]["Enums"]["level_review_status"]
          under_review_at?: string | null
          under_review_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "level_review_adjustment_fk"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "player_rating_admin_adjustments"
            referencedColumns: ["id"]
          },
        ]
      }
      player_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string
          dominant_hand: string | null
          estimated_level: number | null
          invited_at: string | null
          invited_by: string | null
          is_provisional: boolean
          preferred_side: string
          rating_input_source: string
          source_match_event_id: string | null
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name: string
          dominant_hand?: string | null
          estimated_level?: number | null
          invited_at?: string | null
          invited_by?: string | null
          is_provisional?: boolean
          preferred_side: string
          rating_input_source?: string
          source_match_event_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          dominant_hand?: string | null
          estimated_level?: number | null
          invited_at?: string | null
          invited_by?: string | null
          is_provisional?: boolean
          preferred_side?: string
          rating_input_source?: string
          source_match_event_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_profiles_source_match_event_id_fkey"
            columns: ["source_match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      player_rating_adjustment_states: {
        Row: {
          adjustment_id: string
          confirmed_groups: number
          created_at: string
          display_level: number
          highest_display_level: number
          last_rating_at: string | null
          mu: number
          projection_revision: number
          rating_config_version: number
          rating_engine: string
          rating_engine_version: string
          reliability_percent: number
          sigma: number
        }
        ComputedFields: never
        Insert: {
          adjustment_id: string
          confirmed_groups: number
          created_at?: string
          display_level: number
          highest_display_level: number
          last_rating_at?: string | null
          mu: number
          projection_revision: number
          rating_config_version: number
          rating_engine: string
          rating_engine_version: string
          reliability_percent: number
          sigma: number
        }
        Update: {
          adjustment_id?: string
          confirmed_groups?: number
          created_at?: string
          display_level?: number
          highest_display_level?: number
          last_rating_at?: string | null
          mu?: number
          projection_revision?: number
          rating_config_version?: number
          rating_engine?: string
          rating_engine_version?: string
          reliability_percent?: number
          sigma?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_rating_adjustment_states_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "player_rating_admin_adjustments"
            referencedColumns: ["id"]
          },
        ]
      }
      player_rating_admin_adjustments: {
        Row: {
          actor_id: string
          after_confirmed_groups: number
          after_display_level: number
          after_engine_version: string
          after_highest_display_level: number
          after_mu: number
          after_reliability_percent: number
          after_sigma: number
          before_confirmed_groups: number
          before_display_level: number
          before_engine_version: string
          before_highest_display_level: number
          before_mu: number
          before_reliability_percent: number
          before_sigma: number
          boundary_basis: string
          boundary_group_id: string
          boundary_played_at: string
          created_at: string
          decided_at: string
          effective_at: string
          event_type: string
          exception_justification: string | null
          id: string
          last_rating_at: string | null
          level_review_request_id: string
          projection_revision: number
          rating_config_version: number
          rating_engine: string
          reason: string
          reliability_mode: string
          reliability_target: number | null
          user_id: string
          level_review_adjustment_dto: Json | null
        }
        ComputedFields: "level_review_adjustment_dto"
        Insert: {
          actor_id: string
          after_confirmed_groups: number
          after_display_level: number
          after_engine_version: string
          after_highest_display_level: number
          after_mu: number
          after_reliability_percent: number
          after_sigma: number
          before_confirmed_groups: number
          before_display_level: number
          before_engine_version: string
          before_highest_display_level: number
          before_mu: number
          before_reliability_percent: number
          before_sigma: number
          boundary_basis: string
          boundary_group_id: string
          boundary_played_at: string
          created_at?: string
          decided_at: string
          effective_at: string
          event_type?: string
          exception_justification?: string | null
          id?: string
          last_rating_at?: string | null
          level_review_request_id: string
          projection_revision: number
          rating_config_version: number
          rating_engine: string
          reason: string
          reliability_mode: string
          reliability_target?: number | null
          user_id: string
        }
        Update: {
          actor_id?: string
          after_confirmed_groups?: number
          after_display_level?: number
          after_engine_version?: string
          after_highest_display_level?: number
          after_mu?: number
          after_reliability_percent?: number
          after_sigma?: number
          before_confirmed_groups?: number
          before_display_level?: number
          before_engine_version?: string
          before_highest_display_level?: number
          before_mu?: number
          before_reliability_percent?: number
          before_sigma?: number
          boundary_basis?: string
          boundary_group_id?: string
          boundary_played_at?: string
          created_at?: string
          decided_at?: string
          effective_at?: string
          event_type?: string
          exception_justification?: string | null
          id?: string
          last_rating_at?: string | null
          level_review_request_id?: string
          projection_revision?: number
          rating_config_version?: number
          rating_engine?: string
          reason?: string
          reliability_mode?: string
          reliability_target?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_rating_adjustment_request_fk"
            columns: ["level_review_request_id"]
            isOneToOne: true
            referencedRelation: "player_level_review_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_rating_admin_adjustments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      player_rating_event_calculations: {
        Row: {
          after_confirmed_groups: number
          after_display_level: number
          after_highest_display_level: number
          after_mu: number
          after_reliability_percent: number
          after_sigma: number
          before_confirmed_groups: number
          before_display_level: number
          before_highest_display_level: number
          before_mu: number
          before_reliability_percent: number
          before_sigma: number
          calculated_at: string
          explanation: NonNullable<Json>
          inputs: NonNullable<Json>
          last_rating_at: string
          projection_revision: number
          rating_config_version: number
          rating_engine: string
          rating_engine_version: string
          rating_event_id: string
          source_revision: number
        }
        ComputedFields: never
        Insert: {
          after_confirmed_groups: number
          after_display_level: number
          after_highest_display_level: number
          after_mu: number
          after_reliability_percent: number
          after_sigma: number
          before_confirmed_groups: number
          before_display_level: number
          before_highest_display_level: number
          before_mu: number
          before_reliability_percent: number
          before_sigma: number
          calculated_at?: string
          explanation: NonNullable<Json>
          inputs: NonNullable<Json>
          last_rating_at: string
          projection_revision: number
          rating_config_version: number
          rating_engine: string
          rating_engine_version: string
          rating_event_id: string
          source_revision: number
        }
        Update: {
          after_confirmed_groups?: number
          after_display_level?: number
          after_highest_display_level?: number
          after_mu?: number
          after_reliability_percent?: number
          after_sigma?: number
          before_confirmed_groups?: number
          before_display_level?: number
          before_highest_display_level?: number
          before_mu?: number
          before_reliability_percent?: number
          before_sigma?: number
          calculated_at?: string
          explanation?: NonNullable<Json>
          inputs?: NonNullable<Json>
          last_rating_at?: string
          projection_revision?: number
          rating_config_version?: number
          rating_engine?: string
          rating_engine_version?: string
          rating_event_id?: string
          source_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_rating_calculation_source_fk"
            columns: ["rating_event_id", "source_revision"]
            isOneToOne: false
            referencedRelation: "player_rating_event_sources"
            referencedColumns: ["rating_event_id", "projection_revision"]
          },
          {
            foreignKeyName: "player_rating_event_calculations_rating_event_id_fkey"
            columns: ["rating_event_id"]
            isOneToOne: false
            referencedRelation: "player_rating_events"
            referencedColumns: ["id"]
          },
        ]
      }
      player_rating_event_sources: {
        Row: {
          amendment_id: string | null
          confirmation_id: string
          game_group_id: string
          is_active: boolean
          played_at: string
          projection_revision: number
          proposal_version: number
          rating_event_id: string
          reason: string
          recorded_at: string
          repair_job_id: string | null
        }
        ComputedFields: never
        Insert: {
          amendment_id?: string | null
          confirmation_id: string
          game_group_id: string
          is_active: boolean
          played_at: string
          projection_revision: number
          proposal_version: number
          rating_event_id: string
          reason: string
          recorded_at?: string
          repair_job_id?: string | null
        }
        Update: {
          amendment_id?: string | null
          confirmation_id?: string
          game_group_id?: string
          is_active?: boolean
          played_at?: string
          projection_revision?: number
          proposal_version?: number
          rating_event_id?: string
          reason?: string
          recorded_at?: string
          repair_job_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_rating_event_source_confirmation_fk"
            columns: ["confirmation_id", "game_group_id", "proposal_version"]
            isOneToOne: false
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id", "proposal_id", "proposal_version"]
          },
          {
            foreignKeyName: "player_rating_event_source_event_fk"
            columns: ["rating_event_id", "game_group_id"]
            isOneToOne: false
            referencedRelation: "player_rating_events"
            referencedColumns: ["id", "game_group_id"]
          },
          {
            foreignKeyName: "player_rating_event_sources_amendment_id_fkey"
            columns: ["amendment_id"]
            isOneToOne: false
            referencedRelation: "result_amendment_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_rating_event_sources_repair_job_id_fkey"
            columns: ["repair_job_id"]
            isOneToOne: false
            referencedRelation: "result_repair_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      player_rating_events: {
        Row: {
          confirmation_id: string
          created_at: string
          game_group_id: string
          game_group_number: number
          id: string
          match_event_id: string
          played_at: string
          proposal_version: number
          user_id: string
        }
        ComputedFields: never
        Insert: {
          confirmation_id: string
          created_at?: string
          game_group_id: string
          game_group_number: number
          id?: string
          match_event_id: string
          played_at: string
          proposal_version: number
          user_id: string
        }
        Update: {
          confirmation_id?: string
          created_at?: string
          game_group_id?: string
          game_group_number?: number
          id?: string
          match_event_id?: string
          played_at?: string
          proposal_version?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_rating_event_confirmation_fk"
            columns: ["confirmation_id", "game_group_id", "proposal_version"]
            isOneToOne: false
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id", "proposal_id", "proposal_version"]
          },
          {
            foreignKeyName: "player_rating_event_pointer_fk"
            columns: ["game_group_id", "match_event_id", "game_group_number"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposals"
            referencedColumns: ["id", "match_event_id", "group_number"]
          },
          {
            foreignKeyName: "player_rating_event_version_fk"
            columns: ["game_group_id", "proposal_version"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposal_versions"
            referencedColumns: ["proposal_id", "version"]
          },
          {
            foreignKeyName: "player_rating_events_game_group_id_fkey"
            columns: ["game_group_id"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_rating_events_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_rating_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      player_rating_initializations: {
        Row: {
          before_initial_level: number | null
          id: string
          initial_level: number
          original_estimate_level: number | null
          provenance: string
          rating_config_version: number
          rating_engine: string
          rating_engine_version: string
          reason: string
          recorded_at: string
          sequence: number
          user_id: string
        }
        ComputedFields: never
        Insert: {
          before_initial_level?: number | null
          id?: string
          initial_level: number
          original_estimate_level?: number | null
          provenance: string
          rating_config_version: number
          rating_engine: string
          rating_engine_version: string
          reason: string
          recorded_at?: string
          sequence: number
          user_id: string
        }
        Update: {
          before_initial_level?: number | null
          id?: string
          initial_level?: number
          original_estimate_level?: number | null
          provenance?: string
          rating_config_version?: number
          rating_engine?: string
          rating_engine_version?: string
          reason?: string
          recorded_at?: string
          sequence?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_rating_initializations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      player_rating_projection_control: {
        Row: {
          activation_enabled: boolean
          committed_revision: number
          last_processed_game_group_id: string | null
          last_processed_played_at: string | null
          singleton: boolean
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          activation_enabled?: boolean
          committed_revision?: number
          last_processed_game_group_id?: string | null
          last_processed_played_at?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          activation_enabled?: boolean
          committed_revision?: number
          last_processed_game_group_id?: string | null
          last_processed_played_at?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      provisional_claim_password_pending: {
        Row: {
          created_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      result_amendment_candidates: {
        Row: {
          amendment_id: string
          base_confirmation_id: string
          created_at: string
          proposal_id: string
          version: number
        }
        ComputedFields: never
        Insert: {
          amendment_id: string
          base_confirmation_id: string
          created_at?: string
          proposal_id: string
          version: number
        }
        Update: {
          amendment_id?: string
          base_confirmation_id?: string
          created_at?: string
          proposal_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "result_amendment_candidate_base_fk"
            columns: ["base_confirmation_id"]
            isOneToOne: false
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_amendment_candidate_request_fk"
            columns: ["amendment_id", "proposal_id"]
            isOneToOne: false
            referencedRelation: "result_amendment_requests"
            referencedColumns: ["id", "proposal_id"]
          },
          {
            foreignKeyName: "result_amendment_candidate_version_fk"
            columns: ["proposal_id", "version"]
            isOneToOne: true
            referencedRelation: "match_event_result_proposal_versions"
            referencedColumns: ["proposal_id", "version"]
          },
        ]
      }
      result_amendment_events: {
        Row: {
          actor_id: string | null
          amendment_id: string
          candidate_version: number | null
          command_id: string | null
          data: NonNullable<Json>
          decision_source: string | null
          event_type: string
          from_lifecycle: string | null
          id: string
          occurred_at: string
          seq: number
          to_lifecycle: string
        }
        ComputedFields: never
        Insert: {
          actor_id?: string | null
          amendment_id: string
          candidate_version?: number | null
          command_id?: string | null
          data?: NonNullable<Json>
          decision_source?: string | null
          event_type: string
          from_lifecycle?: string | null
          id?: string
          occurred_at?: string
          seq?: never
          to_lifecycle: string
        }
        Update: {
          actor_id?: string | null
          amendment_id?: string
          candidate_version?: number | null
          command_id?: string | null
          data?: NonNullable<Json>
          decision_source?: string | null
          event_type?: string
          from_lifecycle?: string | null
          id?: string
          occurred_at?: string
          seq?: never
          to_lifecycle?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_amendment_events_amendment_id_fkey"
            columns: ["amendment_id"]
            isOneToOne: false
            referencedRelation: "result_amendment_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      result_amendment_requests: {
        Row: {
          base_confirmation_id: string
          base_version: number
          candidate_version: number | null
          closed_at: string | null
          command_id: string
          decided_at: string | null
          decision_actor_id: string | null
          decision_note: string | null
          decision_source: string | null
          fingerprint: string
          group_number: number
          id: string
          lifecycle: string
          match_event_id: string
          proposal_id: string
          reason: string
          repair_job_id: string | null
          requested_at: string
          requester_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          base_confirmation_id: string
          base_version: number
          candidate_version?: number | null
          closed_at?: string | null
          command_id: string
          decided_at?: string | null
          decision_actor_id?: string | null
          decision_note?: string | null
          decision_source?: string | null
          fingerprint: string
          group_number: number
          id?: string
          lifecycle?: string
          match_event_id: string
          proposal_id: string
          reason: string
          repair_job_id?: string | null
          requested_at?: string
          requester_id: string
          updated_at?: string
        }
        Update: {
          base_confirmation_id?: string
          base_version?: number
          candidate_version?: number | null
          closed_at?: string | null
          command_id?: string
          decided_at?: string | null
          decision_actor_id?: string | null
          decision_note?: string | null
          decision_source?: string | null
          fingerprint?: string
          group_number?: number
          id?: string
          lifecycle?: string
          match_event_id?: string
          proposal_id?: string
          reason?: string
          repair_job_id?: string | null
          requested_at?: string
          requester_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_amendment_base_fk"
            columns: ["base_confirmation_id", "proposal_id", "base_version"]
            isOneToOne: false
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id", "proposal_id", "proposal_version"]
          },
          {
            foreignKeyName: "result_amendment_candidate_fk"
            columns: ["proposal_id", "candidate_version"]
            isOneToOne: false
            referencedRelation: "result_amendment_candidates"
            referencedColumns: ["proposal_id", "version"]
          },
          {
            foreignKeyName: "result_amendment_group_fk"
            columns: ["proposal_id", "match_event_id", "group_number"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposals"
            referencedColumns: ["id", "match_event_id", "group_number"]
          },
          {
            foreignKeyName: "result_amendment_repair_job_fk"
            columns: ["repair_job_id", "id"]
            isOneToOne: false
            referencedRelation: "result_repair_jobs"
            referencedColumns: ["id", "amendment_id"]
          },
        ]
      }
      result_dispute_resolutions: {
        Row: {
          actor_id: string
          amendment_id: string | null
          base_confirmation_id: string | null
          candidate_version: number
          command_id: string
          confirmation_id: string | null
          decided_at: string
          decision: string
          evidence_review_id: string | null
          fingerprint: string
          group_number: number
          id: string
          justification: string
          match_event_id: string
          proposal_id: string
          resolution_kind: string
          result_dispute_resolution_dto: Json | null
        }
        ComputedFields: "result_dispute_resolution_dto"
        Insert: {
          actor_id: string
          amendment_id?: string | null
          base_confirmation_id?: string | null
          candidate_version: number
          command_id: string
          confirmation_id?: string | null
          decided_at?: string
          decision: string
          evidence_review_id?: string | null
          fingerprint: string
          group_number: number
          id?: string
          justification: string
          match_event_id: string
          proposal_id: string
          resolution_kind: string
        }
        Update: {
          actor_id?: string
          amendment_id?: string | null
          base_confirmation_id?: string | null
          candidate_version?: number
          command_id?: string
          confirmation_id?: string | null
          decided_at?: string
          decision?: string
          evidence_review_id?: string | null
          fingerprint?: string
          group_number?: number
          id?: string
          justification?: string
          match_event_id?: string
          proposal_id?: string
          resolution_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_dispute_resolution_amendment_fk"
            columns: ["amendment_id", "proposal_id"]
            isOneToOne: false
            referencedRelation: "result_amendment_requests"
            referencedColumns: ["id", "proposal_id"]
          },
          {
            foreignKeyName: "result_dispute_resolution_group_fk"
            columns: ["proposal_id", "match_event_id", "group_number"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposals"
            referencedColumns: ["id", "match_event_id", "group_number"]
          },
          {
            foreignKeyName: "result_dispute_resolution_version_fk"
            columns: ["proposal_id", "candidate_version"]
            isOneToOne: true
            referencedRelation: "match_event_result_proposal_versions"
            referencedColumns: ["proposal_id", "version"]
          },
          {
            foreignKeyName: "result_dispute_resolutions_base_confirmation_id_fkey"
            columns: ["base_confirmation_id"]
            isOneToOne: false
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_dispute_resolutions_confirmation_id_fkey"
            columns: ["confirmation_id"]
            isOneToOne: false
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_dispute_resolutions_evidence_review_id_fkey"
            columns: ["evidence_review_id"]
            isOneToOne: false
            referencedRelation: "match_event_result_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      result_repair_attempts: {
        Row: {
          attempt_number: number
          base_revision: number | null
          duration_ms: number | null
          events_total: number | null
          failure_code: string | null
          fence_token: string
          finished_at: string | null
          groups_replayed: number | null
          id: string
          job_id: string
          publication: Json | null
          result_revision: number | null
          sources_total: number | null
          stage: string | null
          started_at: string
          status: string
        }
        ComputedFields: never
        Insert: {
          attempt_number: number
          base_revision?: number | null
          duration_ms?: number | null
          events_total?: number | null
          failure_code?: string | null
          fence_token: string
          finished_at?: string | null
          groups_replayed?: number | null
          id?: string
          job_id: string
          publication?: Json | null
          result_revision?: number | null
          sources_total?: number | null
          stage?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          attempt_number?: number
          base_revision?: number | null
          duration_ms?: number | null
          events_total?: number | null
          failure_code?: string | null
          fence_token?: string
          finished_at?: string | null
          groups_replayed?: number | null
          id?: string
          job_id?: string
          publication?: Json | null
          result_revision?: number | null
          sources_total?: number | null
          stage?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_repair_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "result_repair_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      result_repair_jobs: {
        Row: {
          amendment_id: string
          attempt_count: number
          candidate_version: number
          command_fingerprint: string
          committed_revision: number | null
          community_id: string
          expected_base_confirmation_id: string
          failure_code: string | null
          failure_stage: string | null
          finished_at: string | null
          frozen_rating_config_version: number
          frozen_rating_engine: string
          frozen_rating_engine_version: string
          group_number: number
          id: string
          kind: string
          lease_expires_at: string | null
          lease_token: string | null
          match_event_id: string
          next_attempt_at: string | null
          proposal_id: string
          reason: string
          requested_at: string
          requested_by: string | null
          resolution_id: string | null
          started_at: string | null
          status: string
          updated_at: string
          result_repair_job_dto: Json | null
        }
        ComputedFields: "result_repair_job_dto"
        Insert: {
          amendment_id: string
          attempt_count?: number
          candidate_version: number
          command_fingerprint: string
          committed_revision?: number | null
          community_id: string
          expected_base_confirmation_id: string
          failure_code?: string | null
          failure_stage?: string | null
          finished_at?: string | null
          frozen_rating_config_version?: number
          frozen_rating_engine?: string
          frozen_rating_engine_version?: string
          group_number: number
          id?: string
          kind: string
          lease_expires_at?: string | null
          lease_token?: string | null
          match_event_id: string
          next_attempt_at?: string | null
          proposal_id: string
          reason: string
          requested_at?: string
          requested_by?: string | null
          resolution_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amendment_id?: string
          attempt_count?: number
          candidate_version?: number
          command_fingerprint?: string
          committed_revision?: number | null
          community_id?: string
          expected_base_confirmation_id?: string
          failure_code?: string | null
          failure_stage?: string | null
          finished_at?: string | null
          frozen_rating_config_version?: number
          frozen_rating_engine?: string
          frozen_rating_engine_version?: string
          group_number?: number
          id?: string
          kind?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          match_event_id?: string
          next_attempt_at?: string | null
          proposal_id?: string
          reason?: string
          requested_at?: string
          requested_by?: string | null
          resolution_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_repair_job_amendment_fk"
            columns: ["amendment_id", "proposal_id"]
            isOneToOne: false
            referencedRelation: "result_amendment_requests"
            referencedColumns: ["id", "proposal_id"]
          },
          {
            foreignKeyName: "result_repair_job_candidate_fk"
            columns: ["proposal_id", "candidate_version"]
            isOneToOne: false
            referencedRelation: "result_amendment_candidates"
            referencedColumns: ["proposal_id", "version"]
          },
          {
            foreignKeyName: "result_repair_job_group_fk"
            columns: ["proposal_id", "match_event_id", "group_number"]
            isOneToOne: false
            referencedRelation: "match_event_result_proposals"
            referencedColumns: ["id", "match_event_id", "group_number"]
          },
          {
            foreignKeyName: "result_repair_jobs_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_repair_jobs_expected_base_confirmation_id_fkey"
            columns: ["expected_base_confirmation_id"]
            isOneToOne: false
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_repair_jobs_resolution_id_fkey"
            columns: ["resolution_id"]
            isOneToOne: false
            referencedRelation: "result_dispute_resolutions"
            referencedColumns: ["id"]
          },
        ]
      }
      statistics_config: {
        Row: {
          active: boolean
          created_at: string
          thresholds: NonNullable<Json>
          version: number
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          created_at?: string
          thresholds: NonNullable<Json>
          version: number
        }
        Update: {
          active?: boolean
          created_at?: string
          thresholds?: NonNullable<Json>
          version?: number
        }
        Relationships: []
      }
      statistics_daily_buckets: {
        Row: {
          activity: NonNullable<Json>
          competitive_groups: number
          confirmed_groups: number
          deciding_set_losses: number
          deciding_set_wins: number
          draws: number
          extrema: NonNullable<Json>
          first_game_group_id: string | null
          first_played_at: string | null
          first_set_lost_converted: number
          first_set_lost_groups: number
          first_set_won_converted: number
          first_set_won_groups: number
          friendly_groups: number
          games_lost: number
          games_won: number
          incomplete_decider_groups: number
          incomplete_groups: number
          last_game_group_id: string | null
          last_played_at: string | null
          losses: number
          match_type: string
          opponent_strength_groups: number
          opponent_strength_sum: number
          played_day: string
          rated_groups: number
          rating_delta_sum: number
          recent: NonNullable<Json>
          relations: NonNullable<Json>
          scope_id: string
          scope_kind: string
          sequence: NonNullable<Json>
          sets_lost: number
          sets_won: number
          straight_set_losses: number
          straight_set_wins: number
          subject_a: string
          subject_b: string
          subject_kind: string
          subject_players: string[]
          three_set_groups: number
          updated_at: string
          upset_wins: number
          wins: number
        }
        ComputedFields: never
        Insert: {
          activity?: NonNullable<Json>
          competitive_groups?: number
          confirmed_groups?: number
          deciding_set_losses?: number
          deciding_set_wins?: number
          draws?: number
          extrema?: NonNullable<Json>
          first_game_group_id?: string | null
          first_played_at?: string | null
          first_set_lost_converted?: number
          first_set_lost_groups?: number
          first_set_won_converted?: number
          first_set_won_groups?: number
          friendly_groups?: number
          games_lost?: number
          games_won?: number
          incomplete_decider_groups?: number
          incomplete_groups?: number
          last_game_group_id?: string | null
          last_played_at?: string | null
          losses?: number
          match_type: string
          opponent_strength_groups?: number
          opponent_strength_sum?: number
          played_day: string
          rated_groups?: number
          rating_delta_sum?: number
          recent?: NonNullable<Json>
          relations?: NonNullable<Json>
          scope_id?: string
          scope_kind: string
          sequence?: NonNullable<Json>
          sets_lost?: number
          sets_won?: number
          straight_set_losses?: number
          straight_set_wins?: number
          subject_a: string
          subject_b?: string
          subject_kind: string
          subject_players?: string[]
          three_set_groups?: number
          updated_at?: string
          upset_wins?: number
          wins?: number
        }
        Update: {
          activity?: NonNullable<Json>
          competitive_groups?: number
          confirmed_groups?: number
          deciding_set_losses?: number
          deciding_set_wins?: number
          draws?: number
          extrema?: NonNullable<Json>
          first_game_group_id?: string | null
          first_played_at?: string | null
          first_set_lost_converted?: number
          first_set_lost_groups?: number
          first_set_won_converted?: number
          first_set_won_groups?: number
          friendly_groups?: number
          games_lost?: number
          games_won?: number
          incomplete_decider_groups?: number
          incomplete_groups?: number
          last_game_group_id?: string | null
          last_played_at?: string | null
          losses?: number
          match_type?: string
          opponent_strength_groups?: number
          opponent_strength_sum?: number
          played_day?: string
          rated_groups?: number
          rating_delta_sum?: number
          recent?: NonNullable<Json>
          relations?: NonNullable<Json>
          scope_id?: string
          scope_kind?: string
          sequence?: NonNullable<Json>
          sets_lost?: number
          sets_won?: number
          straight_set_losses?: number
          straight_set_wins?: number
          subject_a?: string
          subject_b?: string
          subject_kind?: string
          subject_players?: string[]
          three_set_groups?: number
          updated_at?: string
          upset_wins?: number
          wins?: number
        }
        Relationships: []
      }
      statistics_group_facts: {
        Row: {
          audit_event_id: string | null
          classification: string
          community_id: string
          confirmation_id: string
          confirmation_source: string
          confirmed_at: string
          deciding_winner: string | null
          first_set_winner: string | null
          game_group_id: string
          games_a: number
          games_b: number
          group_number: number
          incomplete_decider: boolean
          league_eligible: boolean
          league_id: string | null
          match_event_id: string
          match_type: string
          matchup_high_pair_id: string
          matchup_id: string
          matchup_low_pair_id: string
          matchup_low_side: string
          played_at: string
          played_day: string
          projected_at: string
          proposal_version: number
          quartet_id: string
          rating_expected: boolean
          rating_revision: number | null
          set_count: number
          sets: NonNullable<Json>
          sets_a: number
          sets_b: number
          source_hash: string
          straight_winner: string | null
          team_a_pair_id: string
          team_a_players: string[]
          team_b_pair_id: string
          team_b_players: string[]
          three_set: boolean
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          audit_event_id?: string | null
          classification: string
          community_id: string
          confirmation_id: string
          confirmation_source: string
          confirmed_at: string
          deciding_winner?: string | null
          first_set_winner?: string | null
          game_group_id: string
          games_a: number
          games_b: number
          group_number: number
          incomplete_decider: boolean
          league_eligible: boolean
          league_id?: string | null
          match_event_id: string
          match_type: string
          matchup_high_pair_id: string
          matchup_id: string
          matchup_low_pair_id: string
          matchup_low_side: string
          played_at: string
          played_day: string
          projected_at?: string
          proposal_version: number
          quartet_id: string
          rating_expected: boolean
          rating_revision?: number | null
          set_count: number
          sets: NonNullable<Json>
          sets_a: number
          sets_b: number
          source_hash: string
          straight_winner?: string | null
          team_a_pair_id: string
          team_a_players: string[]
          team_b_pair_id: string
          team_b_players: string[]
          three_set: boolean
          updated_at?: string
        }
        Update: {
          audit_event_id?: string | null
          classification?: string
          community_id?: string
          confirmation_id?: string
          confirmation_source?: string
          confirmed_at?: string
          deciding_winner?: string | null
          first_set_winner?: string | null
          game_group_id?: string
          games_a?: number
          games_b?: number
          group_number?: number
          incomplete_decider?: boolean
          league_eligible?: boolean
          league_id?: string | null
          match_event_id?: string
          match_type?: string
          matchup_high_pair_id?: string
          matchup_id?: string
          matchup_low_pair_id?: string
          matchup_low_side?: string
          played_at?: string
          played_day?: string
          projected_at?: string
          proposal_version?: number
          quartet_id?: string
          rating_expected?: boolean
          rating_revision?: number | null
          set_count?: number
          sets?: NonNullable<Json>
          sets_a?: number
          sets_b?: number
          source_hash?: string
          straight_winner?: string | null
          team_a_pair_id?: string
          team_a_players?: string[]
          team_b_pair_id?: string
          team_b_players?: string[]
          three_set?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "statistics_group_facts_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statistics_group_facts_confirmation_id_fkey"
            columns: ["confirmation_id"]
            isOneToOne: true
            referencedRelation: "match_event_result_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statistics_group_facts_game_group_id_fkey"
            columns: ["game_group_id"]
            isOneToOne: true
            referencedRelation: "match_event_result_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statistics_group_facts_match_event_id_fkey"
            columns: ["match_event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      statistics_league_positions: {
        Row: {
          basis: string
          community_id: string
          effective_end_at: string
          league_id: string
          league_position: number
          period_start_at: string
          player_id: string
          published_at: string
          standings_version: number
        }
        ComputedFields: never
        Insert: {
          basis: string
          community_id: string
          effective_end_at: string
          league_id: string
          league_position: number
          period_start_at: string
          player_id: string
          published_at: string
          standings_version: number
        }
        Update: {
          basis?: string
          community_id?: string
          effective_end_at?: string
          league_id?: string
          league_position?: number
          period_start_at?: string
          player_id?: string
          published_at?: string
          standings_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "statistics_league_positions_league_fk"
            columns: ["league_id", "community_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id", "community_id"]
          },
        ]
      }
      statistics_lifecycle_dirty: {
        Row: {
          event_id: string
          id: number
        }
        ComputedFields: never
        Insert: {
          event_id: string
          id?: never
        }
        Update: {
          event_id?: string
          id?: never
        }
        Relationships: []
      }
      statistics_opponent_facts: {
        Row: {
          community_id: string
          game_group_id: string
          high_expected_score: number | null
          high_opponent_strength: number | null
          high_rating_delta: number | null
          league_eligible: boolean
          league_id: string | null
          low_expected_score: number | null
          low_opponent_strength: number | null
          low_rating_delta: number | null
          low_side: string
          match_type: string
          played_at: string
          played_day: string
          player_high: string
          player_low: string
          rating_expected: boolean
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          community_id: string
          game_group_id: string
          high_expected_score?: number | null
          high_opponent_strength?: number | null
          high_rating_delta?: number | null
          league_eligible: boolean
          league_id?: string | null
          low_expected_score?: number | null
          low_opponent_strength?: number | null
          low_rating_delta?: number | null
          low_side: string
          match_type: string
          played_at: string
          played_day: string
          player_high: string
          player_low: string
          rating_expected: boolean
          updated_at?: string
        }
        Update: {
          community_id?: string
          game_group_id?: string
          high_expected_score?: number | null
          high_opponent_strength?: number | null
          high_rating_delta?: number | null
          league_eligible?: boolean
          league_id?: string | null
          low_expected_score?: number | null
          low_opponent_strength?: number | null
          low_rating_delta?: number | null
          low_side?: string
          match_type?: string
          played_at?: string
          played_day?: string
          player_high?: string
          player_low?: string
          rating_expected?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "statistics_opponent_facts_game_group_id_fkey"
            columns: ["game_group_id"]
            isOneToOne: false
            referencedRelation: "statistics_group_facts"
            referencedColumns: ["game_group_id"]
          },
        ]
      }
      statistics_pair_facts: {
        Row: {
          community_id: string
          expected_score: number | null
          game_group_id: string
          league_eligible: boolean
          league_id: string | null
          match_type: string
          matchup_id: string
          opponent_pair_id: string
          opponent_team_strength: number | null
          own_team_strength: number | null
          pair_id: string
          played_at: string
          played_day: string
          player_high: string
          player_low: string
          rating_calc_revision: number | null
          rating_expected: boolean
          side: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          community_id: string
          expected_score?: number | null
          game_group_id: string
          league_eligible: boolean
          league_id?: string | null
          match_type: string
          matchup_id: string
          opponent_pair_id: string
          opponent_team_strength?: number | null
          own_team_strength?: number | null
          pair_id: string
          played_at: string
          played_day: string
          player_high: string
          player_low: string
          rating_calc_revision?: number | null
          rating_expected: boolean
          side: string
          updated_at?: string
        }
        Update: {
          community_id?: string
          expected_score?: number | null
          game_group_id?: string
          league_eligible?: boolean
          league_id?: string | null
          match_type?: string
          matchup_id?: string
          opponent_pair_id?: string
          opponent_team_strength?: number | null
          own_team_strength?: number | null
          pair_id?: string
          played_at?: string
          played_day?: string
          player_high?: string
          player_low?: string
          rating_calc_revision?: number | null
          rating_expected?: boolean
          side?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "statistics_pair_facts_game_group_id_fkey"
            columns: ["game_group_id"]
            isOneToOne: false
            referencedRelation: "statistics_group_facts"
            referencedColumns: ["game_group_id"]
          },
        ]
      }
      statistics_participant_facts: {
        Row: {
          after_level: number | null
          after_reliability: number | null
          before_level: number | null
          before_reliability: number | null
          community_id: string
          expected_score: number | null
          game_group_id: string
          league_eligible: boolean
          league_id: string | null
          match_type: string
          opponent_team_strength: number | null
          own_team_strength: number | null
          partner_id: string
          played_at: string
          played_day: string
          rating_calc_revision: number | null
          rating_delta: number | null
          rating_expected: boolean
          side: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          after_level?: number | null
          after_reliability?: number | null
          before_level?: number | null
          before_reliability?: number | null
          community_id: string
          expected_score?: number | null
          game_group_id: string
          league_eligible: boolean
          league_id?: string | null
          match_type: string
          opponent_team_strength?: number | null
          own_team_strength?: number | null
          partner_id: string
          played_at: string
          played_day: string
          rating_calc_revision?: number | null
          rating_delta?: number | null
          rating_expected: boolean
          side: string
          updated_at?: string
          user_id: string
        }
        Update: {
          after_level?: number | null
          after_reliability?: number | null
          before_level?: number | null
          before_reliability?: number | null
          community_id?: string
          expected_score?: number | null
          game_group_id?: string
          league_eligible?: boolean
          league_id?: string | null
          match_type?: string
          opponent_team_strength?: number | null
          own_team_strength?: number | null
          partner_id?: string
          played_at?: string
          played_day?: string
          rating_calc_revision?: number | null
          rating_delta?: number | null
          rating_expected?: boolean
          side?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "statistics_participant_facts_game_group_id_fkey"
            columns: ["game_group_id"]
            isOneToOne: false
            referencedRelation: "statistics_group_facts"
            referencedColumns: ["game_group_id"]
          },
        ]
      }
      statistics_participant_lifecycle: {
        Row: {
          community_id: string
          entry_kind: string
          event_id: string
          group_number: number | null
          league_id: string | null
          lifecycle_status: string
          match_type: string
          played_at: string | null
          sort_at: string
          stable_id: string
          user_id: string
          viewer_side: string | null
        }
        ComputedFields: never
        Insert: {
          community_id: string
          entry_kind: string
          event_id: string
          group_number?: number | null
          league_id?: string | null
          lifecycle_status: string
          match_type: string
          played_at?: string | null
          sort_at: string
          stable_id: string
          user_id: string
          viewer_side?: string | null
        }
        Update: {
          community_id?: string
          entry_kind?: string
          event_id?: string
          group_number?: number | null
          league_id?: string | null
          lifecycle_status?: string
          match_type?: string
          played_at?: string | null
          sort_at?: string
          stable_id?: string
          user_id?: string
          viewer_side?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "statistics_participant_lifecycle_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statistics_participant_lifecycle_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "match_events"
            referencedColumns: ["id"]
          },
        ]
      }
      statistics_projection_control: {
        Row: {
          config_version: number
          rating_revision: number
          revision: number
          singleton: boolean
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          config_version: number
          rating_revision?: number
          revision?: number
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          config_version?: number
          rating_revision?: number
          revision?: number
          singleton?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "statistics_projection_control_config_version_fkey"
            columns: ["config_version"]
            isOneToOne: false
            referencedRelation: "statistics_config"
            referencedColumns: ["version"]
          },
        ]
      }
      statistics_rank_control: {
        Row: {
          rating_revision: number
          singleton: boolean
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          rating_revision?: number
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          rating_revision?: number
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      statistics_rank_dirty: {
        Row: {
          cause: string
          community_id: string
          id: number
          league_id: string | null
          marked_at: string
          player_id: string | null
        }
        ComputedFields: never
        Insert: {
          cause: string
          community_id: string
          id?: never
          league_id?: string | null
          marked_at?: string
          player_id?: string | null
        }
        Update: {
          cause?: string
          community_id?: string
          id?: never
          league_id?: string | null
          marked_at?: string
          player_id?: string | null
        }
        Relationships: []
      }
      statistics_rank_transitions: {
        Row: {
          community_id: string
          complete: boolean
          display_level: number | null
          effective_from: string
          established: boolean | null
          player_id: string
          provenance: NonNullable<Json>
          ranked_members: number | null
          rating_revision: number | null
          recorded_at: string
          reliability_percent: number | null
          skill_rank: number | null
          status: string
        }
        ComputedFields: never
        Insert: {
          community_id: string
          complete: boolean
          display_level?: number | null
          effective_from: string
          established?: boolean | null
          player_id: string
          provenance: NonNullable<Json>
          ranked_members?: number | null
          rating_revision?: number | null
          recorded_at?: string
          reliability_percent?: number | null
          skill_rank?: number | null
          status: string
        }
        Update: {
          community_id?: string
          complete?: boolean
          display_level?: number | null
          effective_from?: string
          established?: boolean | null
          player_id?: string
          provenance?: NonNullable<Json>
          ranked_members?: number | null
          rating_revision?: number | null
          recorded_at?: string
          reliability_percent?: number | null
          skill_rank?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "statistics_rank_transitions_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      statistics_scope_summaries: {
        Row: {
          activity: NonNullable<Json>
          competitive_groups: number
          confirmed_groups: number
          deciding_set_losses: number
          deciding_set_wins: number
          draws: number
          extrema: NonNullable<Json>
          first_game_group_id: string | null
          first_played_at: string | null
          first_set_lost_converted: number
          first_set_lost_groups: number
          first_set_won_converted: number
          first_set_won_groups: number
          friendly_groups: number
          games_lost: number
          games_won: number
          incomplete_decider_groups: number
          incomplete_groups: number
          last_game_group_id: string | null
          last_played_at: string | null
          losses: number
          match_type: string
          opponent_strength_groups: number
          opponent_strength_sum: number
          rated_groups: number
          rating_delta_sum: number
          recent: NonNullable<Json>
          relations: NonNullable<Json>
          scope_id: string
          scope_kind: string
          sequence: NonNullable<Json>
          sets_lost: number
          sets_won: number
          straight_set_losses: number
          straight_set_wins: number
          subject_a: string
          subject_b: string
          subject_kind: string
          subject_players: string[]
          three_set_groups: number
          updated_at: string
          upset_wins: number
          wins: number
        }
        ComputedFields: never
        Insert: {
          activity?: NonNullable<Json>
          competitive_groups?: number
          confirmed_groups?: number
          deciding_set_losses?: number
          deciding_set_wins?: number
          draws?: number
          extrema?: NonNullable<Json>
          first_game_group_id?: string | null
          first_played_at?: string | null
          first_set_lost_converted?: number
          first_set_lost_groups?: number
          first_set_won_converted?: number
          first_set_won_groups?: number
          friendly_groups?: number
          games_lost?: number
          games_won?: number
          incomplete_decider_groups?: number
          incomplete_groups?: number
          last_game_group_id?: string | null
          last_played_at?: string | null
          losses?: number
          match_type: string
          opponent_strength_groups?: number
          opponent_strength_sum?: number
          rated_groups?: number
          rating_delta_sum?: number
          recent?: NonNullable<Json>
          relations?: NonNullable<Json>
          scope_id?: string
          scope_kind: string
          sequence?: NonNullable<Json>
          sets_lost?: number
          sets_won?: number
          straight_set_losses?: number
          straight_set_wins?: number
          subject_a: string
          subject_b?: string
          subject_kind: string
          subject_players?: string[]
          three_set_groups?: number
          updated_at?: string
          upset_wins?: number
          wins?: number
        }
        Update: {
          activity?: NonNullable<Json>
          competitive_groups?: number
          confirmed_groups?: number
          deciding_set_losses?: number
          deciding_set_wins?: number
          draws?: number
          extrema?: NonNullable<Json>
          first_game_group_id?: string | null
          first_played_at?: string | null
          first_set_lost_converted?: number
          first_set_lost_groups?: number
          first_set_won_converted?: number
          first_set_won_groups?: number
          friendly_groups?: number
          games_lost?: number
          games_won?: number
          incomplete_decider_groups?: number
          incomplete_groups?: number
          last_game_group_id?: string | null
          last_played_at?: string | null
          losses?: number
          match_type?: string
          opponent_strength_groups?: number
          opponent_strength_sum?: number
          rated_groups?: number
          rating_delta_sum?: number
          recent?: NonNullable<Json>
          relations?: NonNullable<Json>
          scope_id?: string
          scope_kind?: string
          sequence?: NonNullable<Json>
          sets_lost?: number
          sets_won?: number
          straight_set_losses?: number
          straight_set_wins?: number
          subject_a?: string
          subject_b?: string
          subject_kind?: string
          subject_players?: string[]
          three_set_groups?: number
          updated_at?: string
          upset_wins?: number
          wins?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_community_invitation: {
        Args: { p_token: string }
        Returns: {
          community_id: string
          status: Database["public"]["Enums"]["community_membership_status"]
        }[]
      }
      accept_my_notification_invitation: {
        Args: { p_notification_id: string }
        Returns: {
          community_id: string
          status: Database["public"]["Enums"]["community_membership_status"]
        }[]
      }
      accept_result_amendment_locked: {
        Args: {
          p_actor: string
          p_amendment_id: string
          p_command_id: string
          p_expected_version: number
          p_source: string
        }
        Returns: string
      }
      activate_global_rating_projection: { Args: Record<PropertyKey, never>; Returns: Json }
      activate_league: { Args: { p_expected_version: number; p_league_id: string }; Returns: Json }
      actor_session_revoked: { Args: Record<PropertyKey, never>; Returns: boolean }
      add_match_player: {
        Args: {
          p_display_name: string
          p_email: string
          p_estimated_level: number
          p_locale: string
          p_match_event_id: string
          p_request_id: string
        }
        Returns: Json
      }
      advance_match_registration_revision_locked: { Args: { p_event_id: string }; Returns: number }
      assert_actor_not_provisional: { Args: Record<PropertyKey, never>; Returns: undefined }
      assert_match_event_active_locked: { Args: { p_event_id: string }; Returns: undefined }
      assert_match_league_binding: {
        Args: {
          p_community_id: string
          p_event_type: Database["public"]["Enums"]["match_event_type"]
          p_league_id: string
          p_published_at?: string
          p_starts_at: string
        }
        Returns: undefined
      }
      assert_match_league_edit_locked: {
        Args: {
          p_community_id: string
          p_current_league_id: string
          p_event_id: string
          p_event_type: Database["public"]["Enums"]["match_event_type"]
          p_league_id: string
          p_published_at: string
          p_starts_at: string
        }
        Returns: undefined
      }
      assert_match_league_window: {
        Args: { p_community_id: string; p_league_id: string; p_starts_at: string }
        Returns: undefined
      }
      assert_match_management_action_locked: {
        Args: { p_action: string; p_event_id: string }
        Returns: undefined
      }
      assert_match_player_add_window_locked: { Args: { p_event_id: string }; Returns: undefined }
      can_read_community: { Args: { p_community_id: string }; Returns: boolean }
      can_read_match_event: { Args: { p_event_id: string }; Returns: boolean }
      cancel_level_review_request: { Args: { p_request_id: string }; Returns: Json }
      cancel_match_event: {
        Args: {
          p_expected_version: number
          p_match_event_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      cancel_result_amendment: {
        Args: { p_amendment_id: string; p_command_id: string }
        Returns: Json
      }
      claim_due_result_repairs: { Args: { p_limit?: number }; Returns: Json }
      claim_match_player_add_redrives: { Args: { p_limit?: number }; Returns: Json }
      claim_provisional_player: {
        Args: {
          p_bio?: string
          p_display_name: string
          p_dominant_hand?: string
          p_initial_level: number
          p_preferred_side: string
        }
        Returns: undefined
      }
      claim_result_repair_job: {
        Args: { p_job_id?: string; p_lease_seconds?: number }
        Returns: Json
      }
      classify_match_result_sets: { Args: { p_sets: Json }; Returns: string }
      close_league: { Args: { p_expected_version: number; p_league_id: string }; Returns: Json }
      complete_match_player_add_locked: {
        Args: { p_new_identity: boolean; p_operation_id: string; p_user_id: string }
        Returns: undefined
      }
      correct_match_event_result: {
        Args: {
          p_court_label?: string
          p_expected_version: number
          p_played_local: Json
          p_proposal_id: string
          p_request_id?: string
          p_sets: Json
          p_teams: Json
        }
        Returns: Json
      }
      count_my_unread_notifications: { Args: Record<PropertyKey, never>; Returns: number }
      create_community: {
        Args: {
          p_city_label?: string
          p_description?: string
          p_join_policy: Database["public"]["Enums"]["community_join_policy"]
          p_name: string
          p_visibility: Database["public"]["Enums"]["community_visibility"]
        }
        Returns: string
      }
      create_league: {
        Args: {
          p_community_id: string
          p_description?: string
          p_end_date?: string
          p_end_mode: string
          p_minimum_matches?: number
          p_name: string
          p_request_id: string
          p_start_date: string
        }
        Returns: Json
      }
      decide_match_registration: {
        Args: { p_attempt_id: string; p_decision: string; p_match_event_id: string }
        Returns: Json
      }
      depart_match_registration_locked: {
        Args: {
          p_action: string
          p_attempt_id: string
          p_match_event_id: string
          p_reason: string
          p_request_id: string
          p_target_user_id: string
        }
        Returns: Json
      }
      dispatch_match_player_add: {
        Args: { p_actor_id: string; p_match_event_id: string; p_request_id: string }
        Returns: Json
      }
      edit_match_event: {
        Args: {
          p_expected_version: number
          p_match_event_id: string
          p_patch: Json
          p_request_id: string
        }
        Returns: Json
      }
      ensure_provisional_community_membership_locked: {
        Args: {
          p_added_by: string
          p_community_id: string
          p_source_match_event_id: string
          p_user_id: string
        }
        Returns: string
      }
      execute_claimed_result_repair: {
        Args: { p_attempt_number: number; p_job_id: string }
        Returns: Json
      }
      execute_result_repair: { Args: { p_fence_token: string; p_job_id: string }; Returns: Json }
      expire_match_event_invitations_locked: {
        Args: { p_as_of: string; p_event_id: string }
        Returns: number
      }
      finalize_community_venue_photo: {
        Args: { p_community_id: string; p_object_key: string; p_venue_id: string }
        Returns: undefined
      }
      finalize_match_event_result_locked: {
        Args: {
          p_actor_id: string
          p_expected_version: number
          p_proposal_id: string
          p_source: string
        }
        Returns: string
      }
      finalize_match_event_result_override_locked: {
        Args: {
          p_actor_id: string
          p_command_id: string
          p_confirmation_id: string
          p_expected_version: number
          p_justification: string
          p_proposal_id: string
        }
        Returns: string
      }
      get_community_member_by_id: {
        Args: { p_community_id: string; p_membership_id: string }
        Returns: {
          activated_at: string
          display_level: number
          display_name: string
          membership_id: string
          reliability_percent: number
          role: Database["public"]["Enums"]["community_member_role"]
          status: Database["public"]["Enums"]["community_membership_status"]
          user_id: string
          valid_from: string
          valid_until: string
        }[]
      }
      get_community_settings: {
        Args: { p_community_id: string }
        Returns: {
          id: string
          settings: Json
        }[]
      }
      get_community_statistics: {
        Args: {
          p_community_id?: string
          p_from?: string
          p_league_id?: string
          p_through?: string
          p_type?: string
        }
        Returns: Json
      }
      get_effective_community_admin_defaults: { Args: { p_settings: Json }; Returns: Json }
      get_league: { Args: { p_league_id: string }; Returns: Json }
      get_league_counters: { Args: { p_league_id: string }; Returns: Json }
      get_league_standings: {
        Args: { p_league_id: string; p_standings_version?: number }
        Returns: Json
      }
      get_league_standings_audit: { Args: { p_league_id: string }; Returns: Json }
      get_level_review_access: { Args: Record<PropertyKey, never>; Returns: Json }
      get_level_review_adjustment_preview: {
        Args: {
          p_reliability_mode?: string
          p_reliability_target?: number
          p_request_id: string
          p_target_level: number
        }
        Returns: Json
      }
      get_level_review_admin_detail: { Args: { p_request_id: string }; Returns: Json }
      get_match_creation_options: { Args: { p_community_id?: string }; Returns: Json }
      get_match_event: { Args: { p_event_id: string }; Returns: Json }
      get_match_event_management: { Args: { p_match_event_id: string }; Returns: Json }
      get_match_event_official_results: { Args: { p_match_event_id: string }; Returns: Json[] }
      get_match_event_rating_changes: { Args: { p_match_event_id: string }; Returns: Json }
      get_match_event_result_proposals: { Args: { p_match_event_id: string }; Returns: Json[] }
      get_match_player_add_invite_context: {
        Args: { p_actor_id: string; p_match_event_id: string; p_request_id: string }
        Returns: Json
      }
      get_my_community_notification_timezone: {
        Args: { p_notification_id: string }
        Returns: string
      }
      get_my_community_notification_timezones: {
        Args: { p_notification_ids: string[] }
        Returns: {
          notification_id: string
          time_zone: string
        }[]
      }
      get_my_level_review_request: { Args: { p_request_id: string }; Returns: Json }
      get_my_match_invitation: { Args: { p_match_event_id: string }; Returns: Json }
      get_my_match_notification_contexts: {
        Args: { p_notification_ids: string[] }
        Returns: {
          accepted_count: number
          caller_accepted_order: number
          caller_participation: Database["public"]["Enums"]["match_registration_participation"]
          caller_roster_position: number
          creator_display_name: string
          currency: string
          event_status: string
          event_type: Database["public"]["Enums"]["match_event_type"]
          match_event_id: string
          notification_id: string
          playing_count: number
          price_minor: number
          reconfirmation_required_count: number
          requester_display_name: string
          reserve_count: number
          reserve_not_playing_count: number
          scheduled_at: string
          timezone: string
          venue: string
        }[]
      }
      get_my_match_registration: { Args: { p_match_event_id: string }; Returns: Json }
      get_my_notification_target: {
        Args: { p_notification_id: string }
        Returns: {
          community_id: string
          community_name: string
          invitation_id: string
          membership_status: string
          target_status: string
        }[]
      }
      get_my_notification_target_v2: {
        Args: { p_notification_id: string }
        Returns: {
          community_id: string
          community_name: string
          invitation_id: string
          match_available: boolean
          match_event_id: string
          membership_status: string
          target_status: string
        }[]
      }
      get_my_notification_target_v3: {
        Args: { p_notification_id: string }
        Returns: {
          community_id: string
          community_name: string
          created_at: string
          invitation_id: string
          kind: string
          level_review_context: Json
          match_available: boolean
          match_event_id: string
          membership_status: string
          result_context: Json
          target_status: string
        }[]
      }
      get_my_notifications_as_of: { Args: Record<PropertyKey, never>; Returns: string }
      get_my_rating_history: {
        Args: {
          p_before_game_group_id?: string
          p_before_played_at?: string
          p_limit?: number
          p_revision?: number
        }
        Returns: Json
      }
      get_my_rating_progress: { Args: { p_max_points?: number }; Returns: Json }
      get_my_rating_summary: { Args: Record<PropertyKey, never>; Returns: Json }
      get_my_result_notification_contexts: {
        Args: { p_notification_ids: string[] }
        Returns: {
          classification: string
          community_id: string
          current_status: string
          current_version: number
          entry_ready: boolean
          group_number: number
          is_current: boolean
          loser_sets: number
          match_event_id: string
          notification_id: string
          notification_kind: string
          proposal_id: string
          proposal_status: string
          proposal_version: number
          review_deadline_at: string
          score: string
          starts_at: string
          submitted_by_name: string
          timezone: string
          venue: string
          winner_sets: number
        }[]
      }
      get_opponent_statistics: {
        Args: {
          p_community_id?: string
          p_from?: string
          p_league_id?: string
          p_opponent_id: string
          p_player_id: string
          p_recent_offset?: number
          p_through?: string
          p_type?: string
        }
        Returns: Json
      }
      get_pair_statistics: {
        Args: {
          p_community_id?: string
          p_from?: string
          p_league_id?: string
          p_partner_id: string
          p_player_id: string
          p_recent_offset?: number
          p_through?: string
          p_type?: string
        }
        Returns: Json
      }
      get_password_setup_state: { Args: Record<PropertyKey, never>; Returns: Json }
      get_player_opponent_records: {
        Args: {
          p_community_id?: string
          p_from?: string
          p_league_id?: string
          p_limit?: number
          p_offset?: number
          p_player_id: string
          p_through?: string
          p_type?: string
        }
        Returns: Json
      }
      get_player_partner_records: {
        Args: {
          p_community_id?: string
          p_from?: string
          p_league_id?: string
          p_limit?: number
          p_offset?: number
          p_player_id: string
          p_through?: string
          p_type?: string
        }
        Returns: Json
      }
      get_player_statistics: {
        Args: {
          p_community_id?: string
          p_from?: string
          p_league_id?: string
          p_player_id: string
          p_through?: string
          p_type?: string
        }
        Returns: Json
      }
      get_player_statistics_rank_history: {
        Args: { p_community_id?: string; p_limit?: number; p_player_id: string }
        Returns: Json
      }
      get_provisional_claim_context: { Args: Record<PropertyKey, never>; Returns: Json }
      get_rating_group_explanation: {
        Args: { p_game_group_id: string; p_revision?: number }
        Returns: Json
      }
      get_rating_history_audit: {
        Args: { p_limit?: number; p_revision: number; p_user_id: string }
        Returns: Json
      }
      get_result_amendments: { Args: { p_match_event_id: string }; Returns: Json[] }
      get_result_dispute_resolutions: { Args: { p_match_event_id: string }; Returns: Json[] }
      get_result_repair_attempts: { Args: { p_job_id: string }; Returns: Json[] }
      get_result_repair_diagnostics: { Args: { p_community_id?: string }; Returns: Json }
      get_result_repair_jobs: { Args: { p_match_event_id: string }; Returns: Json[] }
      get_statistics_config: { Args: Record<PropertyKey, never>; Returns: Json }
      get_statistics_group_detail: {
        Args: { p_event_id: string; p_game_group_id: string }
        Returns: Json
      }
      govern_community_member: {
        Args: { p_action: string; p_community_id: string; p_membership_id: string }
        Returns: {
          membership_id: string
          role: Database["public"]["Enums"]["community_member_role"]
          status: Database["public"]["Enums"]["community_membership_status"]
        }[]
      }
      has_match_event_result_approval_coverage: {
        Args: { p_actor_id: string; p_proposal_id: string; p_version: number }
        Returns: boolean
      }
      initialize_global_player_rating_locked: {
        Args: { p_level: number; p_reason?: string; p_user_id: string }
        Returns: undefined
      }
      is_community_admin: { Args: { p_community_id: string }; Returns: boolean }
      is_community_member: { Args: { p_community_id: string }; Returns: boolean }
      is_match_event_participant: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_private_match_event: { Args: { p_event_id: string }; Returns: boolean }
      is_provisional_actor: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_provisional_player: { Args: { p_user_id: string }; Returns: boolean }
      join_public_community: {
        Args: { p_community_id: string }
        Returns: {
          community_id: string
          status: Database["public"]["Enums"]["community_membership_status"]
        }[]
      }
      league_actor_can_manage: {
        Args: { p_community_id: string; p_owner_id: string }
        Returns: boolean
      }
      league_backfill_references_from_audit: { Args: Record<PropertyKey, never>; Returns: number }
      league_community_dto: { Args: { p_community_id: string }; Returns: Json }
      league_confirmed_groups: {
        Args: { p_league_id: string }
        Returns: {
          classification: string
          confirmation_id: string
          confirmed_at: string
          eligible: boolean
          group_number: number
          match_event_id: string
          played_at_utc: string
          proposal_id: string
          proposal_version: number
          sets: Json
          teams: Json
        }[]
      }
      league_counter_rows: {
        Args: { p_league_id: string }
        Returns: {
          draws: number
          losses: number
          matches: number
          sets_lost: number
          sets_won: number
          user_id: string
          wins: number
        }[]
      }
      league_counter_rows_through: {
        Args: { p_league_id: string; p_through: string }
        Returns: {
          draws: number
          losses: number
          matches: number
          sets_lost: number
          sets_won: number
          user_id: string
          wins: number
        }[]
      }
      league_dto: {
        Args: {
          p_league: Omit<
            Database["public"]["Tables"]["leagues"]["Row"],
            Database["public"]["Tables"]["leagues"]["ComputedFields"]
          >
        }
        Returns: Json
      }
      league_has_published_events: { Args: { p_league_id: string }; Returns: boolean }
      league_lock_for_command: {
        Args: { p_expected_version: number; p_league_id: string }
        Returns: {
          activated_at: string | null
          activation_blocked_at: string | null
          closed_at: string | null
          closed_by: string | null
          closed_reason: string | null
          community_id: string
          create_input: NonNullable<Json>
          create_request_id: string
          created_at: string
          description: string | null
          end_at: string | null
          end_mode: Database["public"]["Enums"]["league_end_mode"]
          id: string
          minimum_matches_for_final_award: number
          name: string
          owner_id: string
          start_at: string
          status: Database["public"]["Enums"]["league_status"]
          timezone: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "leagues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      league_period_instants: {
        Args: { p_end_date: string; p_end_mode: string; p_start_date: string; p_timezone: string }
        Returns: string[]
      }
      league_process_community_locked: {
        Args: { p_as_of?: string; p_community_id: string }
        Returns: Json
      }
      league_publish_correction: {
        Args: { p_job_id: string; p_league_id: string }
        Returns: number
      }
      league_publish_late_confirmation: {
        Args: {
          p_basis?: string
          p_confirmation_id: string
          p_league_id: string
          p_through?: string
        }
        Returns: number
      }
      league_publish_repair_if_needed: { Args: { p_league_id: string }; Returns: number }
      league_publish_standings: {
        Args: {
          p_basis: string
          p_cause: string
          p_confirmation_id: string
          p_league_id: string
          p_through: string
        }
        Returns: number
      }
      league_rank_counters: {
        Args: { p_rows: Json; p_threshold: number }
        Returns: {
          award_eligible: boolean
          draws: number
          losses: number
          matches: number
          matches_remaining: number
          place: number
          set_differential: number
          sets_lost: number
          sets_won: number
          user_id: string
          wins: number
        }[]
      }
      league_rebuild_counters_core: { Args: { p_league_id: string }; Returns: Json }
      league_reconstruct_standings: { Args: { p_league_id: string }; Returns: number }
      league_repair_closed_standings: { Args: { p_league_id: string }; Returns: number }
      league_snapshot_content_fingerprint: {
        Args: { p_confirmation_ids: string[] }
        Returns: string
      }
      league_snapshot_fingerprint: { Args: { p_confirmation_ids: string[] }; Returns: string }
      league_standings_entries: {
        Args: { p_league_id: string }
        Returns: {
          award_eligible: boolean
          draws: number
          losses: number
          matches: number
          matches_remaining: number
          place: number
          set_differential: number
          sets_lost: number
          sets_won: number
          user_id: string
          wins: number
        }[]
      }
      league_utc_text: { Args: { p_instant: string }; Returns: string }
      league_valid_text: { Args: { p_max: number; p_value: string }; Returns: boolean }
      leave_community: {
        Args: { p_community_id: string }
        Returns: {
          community_id: string
          membership_id: string
          status: Database["public"]["Enums"]["community_membership_status"]
          valid_until: string
        }[]
      }
      level_review_actor: { Args: Record<PropertyKey, never>; Returns: string }
      level_review_adjustment_dto: {
        Args: {
          a: Omit<
            Database["public"]["Tables"]["player_rating_admin_adjustments"]["Row"],
            Database["public"]["Tables"]["player_rating_admin_adjustments"]["ComputedFields"]
          >
        }
        Returns: Json
      }
      level_review_admin_actor: { Args: Record<PropertyKey, never>; Returns: string }
      level_review_admin_dto: {
        Args: {
          r: Omit<
            Database["public"]["Tables"]["player_level_review_requests"]["Row"],
            Database["public"]["Tables"]["player_level_review_requests"]["ComputedFields"]
          >
        }
        Returns: Json
      }
      level_review_owner_dto: {
        Args: {
          r: Omit<
            Database["public"]["Tables"]["player_level_review_requests"]["Row"],
            Database["public"]["Tables"]["player_level_review_requests"]["ComputedFields"]
          >
        }
        Returns: Json
      }
      level_review_project_adjustment: {
        Args: {
          p_mode: string
          p_rating: Omit<
            Database["public"]["Tables"]["global_player_ratings"]["Row"],
            Database["public"]["Tables"]["global_player_ratings"]["ComputedFields"]
          >
          p_reliability_target: number
          p_target: number
        }
        Returns: Json
      }
      level_review_queue_item_dto: {
        Args: {
          r: Omit<
            Database["public"]["Tables"]["player_level_review_requests"]["Row"],
            Database["public"]["Tables"]["player_level_review_requests"]["ComputedFields"]
          >
        }
        Returns: Json
      }
      level_review_submission_limits: {
        Args: Record<PropertyKey, never>
        Returns: {
          max_requests: number
          window_length: string
        }[]
      }
      level_review_valid_level: { Args: { p_level: number }; Returns: boolean }
      list_league_standings_versions: {
        Args: { p_before_version?: number; p_league_id: string }
        Returns: Json
      }
      list_leagues: {
        Args: { p_after_created_at?: string; p_after_id?: string; p_community_id: string }
        Returns: Json
      }
      list_level_review_queue: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_limit?: number
          p_status?: string
        }
        Returns: Json
      }
      list_match_event_audit: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_match_event_id: string
        }
        Returns: Json[]
      }
      list_match_event_invitations: { Args: { p_match_event_id: string }; Returns: Json[] }
      list_match_event_management_participants: {
        Args: { p_match_event_id: string }
        Returns: Json[]
      }
      list_match_event_registration_requests: {
        Args: { p_match_event_id: string }
        Returns: Json[]
      }
      list_match_event_registrations: { Args: { p_match_event_id: string }; Returns: Json[] }
      list_match_events: {
        Args: {
          p_as_of?: string
          p_community_id?: string
          p_cursor?: string
          p_entry: string
          p_limit?: number
        }
        Returns: Json[]
      }
      list_match_league_options: {
        Args: { p_community_id: string; p_date: string; p_start_time: string }
        Returns: Json
      }
      list_my_level_review_requests: {
        Args: { p_after_created_at?: string; p_after_id?: string; p_limit?: number }
        Returns: Json
      }
      list_statistics_history: {
        Args: {
          p_community_id?: string
          p_cursor_at?: string
          p_cursor_key?: string
          p_from?: string
          p_league_id?: string
          p_limit?: number
          p_revision?: number
          p_subject_player_id?: string
          p_through?: string
          p_type?: string
        }
        Returns: Json
      }
      lock_global_rating_projection: { Args: Record<PropertyKey, never>; Returns: undefined }
      lock_match_event_registration: {
        Args: { p_event_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          community_id: string
          court_booked: boolean
          court_notes: string | null
          created_at: string
          created_by: string
          currency: string | null
          duration_minutes: number | null
          event_type: Database["public"]["Enums"]["match_event_type"]
          id: string
          league_id: string | null
          maps_url: string
          max_level: number | null
          maximum_registrations: number | null
          min_level: number | null
          notes: string | null
          payment_note: string | null
          photo_path: string
          price_minor: number | null
          published_at: string
          published_by: string
          reconfirmation_generation: number
          registration_cutoff_at: string
          restriction_enabled: boolean
          saved_venue_id: string | null
          starts_at: string
          status: string
          team_assignment_mode: Database["public"]["Enums"]["match_team_assignment_mode"]
          timezone: string
          updated_at: string
          venue_name: string
          version: number
          visibility: Database["public"]["Enums"]["match_event_visibility"]
        }
        SetofOptions: {
          from: "*"
          to: "match_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lock_match_event_registration_skip_locked: {
        Args: { p_event_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          community_id: string
          court_booked: boolean
          court_notes: string | null
          created_at: string
          created_by: string
          currency: string | null
          duration_minutes: number | null
          event_type: Database["public"]["Enums"]["match_event_type"]
          id: string
          league_id: string | null
          maps_url: string
          max_level: number | null
          maximum_registrations: number | null
          min_level: number | null
          notes: string | null
          payment_note: string | null
          photo_path: string
          price_minor: number | null
          published_at: string
          published_by: string
          reconfirmation_generation: number
          registration_cutoff_at: string
          restriction_enabled: boolean
          saved_venue_id: string | null
          starts_at: string
          status: string
          team_assignment_mode: Database["public"]["Enums"]["match_team_assignment_mode"]
          timezone: string
          updated_at: string
          venue_name: string
          version: number
          visibility: Database["public"]["Enums"]["match_event_visibility"]
        }
        SetofOptions: {
          from: "*"
          to: "match_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lock_match_player_add_email: { Args: { p_email: string }; Returns: undefined }
      mark_all_notifications_read: { Args: { p_before: string }; Returns: number }
      mark_community_notification_read: {
        Args: { p_notification_id: string }
        Returns: {
          notification_id: string
          read_at: string
        }[]
      }
      mark_level_review_under_review: { Args: { p_request_id: string }; Returns: Json }
      mark_match_result_alert_ineligible: {
        Args: { p_event_id: string; p_fingerprint: string }
        Returns: boolean
      }
      mark_notification_read: { Args: { p_notification_id: string }; Returns: string }
      match_competition_impact: {
        Args: { p_event_type: Database["public"]["Enums"]["match_event_type"]; p_league_id: string }
        Returns: Json
      }
      match_consent_change: { Args: { p_event_id: string; p_generation: number }; Returns: Json }
      match_event_caller_context: {
        Args: { p_event_id: string }
        Returns: {
          caller_eligibility: string
          caller_is_invited: boolean
          caller_requires_approval: boolean
        }[]
      }
      match_event_competition: { Args: { p_event_id: string }; Returns: Json }
      match_event_local_start: {
        Args: { p_date: string; p_time: string; p_zone: string }
        Returns: string
      }
      match_event_official_confirmations: {
        Args: Record<PropertyKey, never>
        Returns: {
          actor_id: string | null
          confirmed_at: string
          effective_at: string
          event_type: Database["public"]["Enums"]["match_event_type"]
          group_number: number
          id: string
          match_event_id: string
          proposal_id: string
          proposal_version: number
          ratable_eligible: boolean
          source: string
        }[]
        SetofOptions: {
          from: "*"
          to: "match_event_result_confirmations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      match_event_result_summary: { Args: { p_match_event_id: string }; Returns: Json }
      match_league_effective_end: {
        Args: { p_closed_at: string; p_end_at: string }
        Returns: string
      }
      match_player_add_actor_authorized: {
        Args: { p_actor_id: string; p_event_id: string }
        Returns: boolean
      }
      match_player_add_digest: { Args: { p_value: string }; Returns: string }
      match_player_add_limits: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>
      }
      match_player_add_redrive_limits: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>
      }
      match_registration_counts:
        | {
            Args: { p_match_event_id: string }
            Returns: {
              accepted_count: number
              playing_count: number
              reconfirmation_required_count: number
              reserve_count: number
              reserve_not_playing_count: number
            }[]
          }
        | {
            Args: { p_as_of: string; p_match_event_id: string }
            Returns: {
              accepted_count: number
              playing_count: number
              reconfirmation_required_count: number
              reserve_count: number
              reserve_not_playing_count: number
            }[]
          }
      match_registration_is_member: {
        Args: { p_community_id: string; p_user_id: string }
        Returns: boolean
      }
      match_registration_roster:
        | {
            Args: { p_match_event_id: string }
            Returns: {
              accepted_order: number
              accepted_total: number
              participation_status: Database["public"]["Enums"]["match_registration_participation"]
              playing_total: number
              registration_id: string
              reserve_total: number
              roster_position: number
              user_id: string
            }[]
          }
        | {
            Args: { p_as_of: string; p_match_event_id: string }
            Returns: {
              accepted_order: number
              accepted_total: number
              participation_status: Database["public"]["Enums"]["match_registration_participation"]
              playing_total: number
              registration_id: string
              reserve_total: number
              roster_position: number
              user_id: string
            }[]
          }
      match_result_alert_aging_at: { Args: { p_enqueued_at: string }; Returns: string }
      match_result_alert_aging_horizon: { Args: Record<PropertyKey, never>; Returns: string }
      match_result_alert_clock: { Args: Record<PropertyKey, never>; Returns: string }
      match_result_alert_lock_defer_interval: { Args: { p_candidate_id: string }; Returns: string }
      match_result_entry_roster_fingerprint: { Args: { p_event_id: string }; Returns: string }
      match_result_fact_quartet: { Args: { p_teams: Json }; Returns: string[] }
      match_result_ranked_ineligibility: {
        Args: { p_event_id: string; p_played_at: string; p_quartet: string[] }
        Returns: Json
      }
      notify_match_result_deadline: {
        Args: { p_proposal_id: string; p_proposal_version: number }
        Returns: number
      }
      notify_match_result_entry_ready: { Args: { p_match_event_id: string }; Returns: boolean }
      notify_match_result_lifecycle: {
        Args: {
          p_confirmation_id?: string
          p_event_key: string
          p_kind: string
          p_proposal_id: string
          p_proposal_version: number
        }
        Returns: number
      }
      notify_match_result_version: {
        Args: { p_proposal_id: string; p_proposal_version: number }
        Returns: number
      }
      onboard_player: {
        Args: {
          p_bio?: string
          p_display_name: string
          p_dominant_hand?: string
          p_initial_level: number
          p_preferred_side: string
        }
        Returns: undefined
      }
      persist_match_result_notification: {
        Args: {
          p_community_id: string
          p_confirmation_id?: string
          p_event_key: string
          p_kind: string
          p_match_event_id: string
          p_proposal_id: string
          p_proposal_version: number
          p_recipient_user_id: string
        }
        Returns: string
      }
      persist_notification: {
        Args: {
          p_category: string
          p_community_id: string
          p_event_key: string
          p_kind: string
          p_recipient_user_id: string
          p_target_id: string
          p_target_type: string
        }
        Returns: string
      }
      player_has_rated_history: { Args: { p_user_id: string }; Returns: boolean }
      player_rating_calculation_inputs_valid: { Args: { p_inputs: Json }; Returns: boolean }
      process_due_leagues: { Args: { p_as_of?: string; p_limit?: number }; Returns: Json }
      process_due_match_event_registration_cutoffs: { Args: { p_limit?: number }; Returns: Json }
      process_due_match_event_results: { Args: { p_limit?: number }; Returns: Json }
      process_due_result_amendments: { Args: { p_limit?: number }; Returns: Json }
      process_match_event_registration_cutoff: {
        Args: { p_match_event_id: string; p_skip_locked?: boolean }
        Returns: Json
      }
      process_match_result_lifecycle_alerts: {
        Args: { p_entry_ready_limit?: number; p_max_examined?: number; p_reminder_limit?: number }
        Returns: Json
      }
      project_confirmed_rating_group: { Args: { p_proposal_id: string }; Returns: undefined }
      project_league_confirmation: { Args: { p_confirmation_id: string }; Returns: boolean }
      protect_match_event_results: { Args: { p_event_id: string }; Returns: undefined }
      provision_provisional_player_locked: {
        Args: {
          p_display_name: string
          p_estimated_level: number
          p_invited_by: string
          p_source_match_event_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      provisional_claim_state: { Args: Record<PropertyKey, never>; Returns: string }
      public_community_discovery: {
        Args: Record<PropertyKey, never>
        Returns: {
          city_label: string
          created_at: string
          description: string
          id: string
          join_policy: Database["public"]["Enums"]["community_join_policy"]
          logo_path: string
          member_count: number
          name: string
          updated_at: string
          visibility: Database["public"]["Enums"]["community_visibility"]
        }[]
      }
      publish_match_event: {
        Args: { p_event_id: string; p_input: Json; p_invitee_ids: string[] }
        Returns: string
      }
      queue_result_repair_job_locked: {
        Args: {
          p_amendment_id: string
          p_command_id: string
          p_kind: string
          p_now: string
          p_reason: string
          p_requested_by: string
          p_resolution_id: string
        }
        Returns: string
      }
      rating_can_view_match_event: {
        Args: { p_match_event_id: string; p_viewer: string }
        Returns: boolean
      }
      rating_checkpoint_incoming: {
        Args: {
          p_adjustment_revision: number
          p_at: string
          p_group_id: string
          p_revision: number
          p_user_id: string
        }
        Returns: {
          display_level: number
          reliability_percent: number
        }[]
      }
      rating_committed_revision: { Args: Record<PropertyKey, never>; Returns: number }
      rating_current_calculations: {
        Args: { p_revision: number; p_user_id: string }
        Returns: {
          after_confirmed_groups: number
          after_display_level: number
          after_highest_display_level: number
          after_reliability_percent: number
          before_confirmed_groups: number
          before_display_level: number
          before_highest_display_level: number
          before_reliability_percent: number
          calculation_revision: number
          explanation: Json
          game_group_id: string
          game_group_number: number
          inputs: Json
          last_rating_at: string
          match_event_id: string
          played_at: string
          rating_config_version: number
          rating_engine: string
          rating_engine_version: string
          rating_event_id: string
          revision_count: number
          source_confirmation_id: string
          source_proposal_version: number
          source_revision: number
        }[]
      }
      rating_event_sources_at: {
        Args: { p_revision: number }
        Returns: {
          confirmation_id: string
          game_group_id: string
          game_group_number: number
          is_active: boolean
          match_event_id: string
          played_at: string
          proposal_version: number
          rating_event_id: string
          source_revision: number
          user_id: string
        }[]
      }
      rating_event_sources_latest: {
        Args: Record<PropertyKey, never>
        Returns: {
          confirmation_id: string
          game_group_id: string
          game_group_number: number
          is_active: boolean
          match_event_id: string
          played_at: string
          proposal_version: number
          rating_event_id: string
          source_revision: number
          user_id: string
        }[]
      }
      rating_group_ledgered_at: {
        Args: { p_confirmation_id: string; p_game_group_id: string }
        Returns: boolean
      }
      rating_projection_apply_group: {
        Args: {
          p_classification: string
          p_confirmation_id: string
          p_context?: Json
          p_game_group_id: string
          p_group_number: number
          p_match_event_id: string
          p_played_at: string
          p_proposal_version: number
          p_revision: number
          p_states: Json
          p_teams: Json
        }
        Returns: Record<string, unknown>
      }
      rating_projection_assert_consistent: { Args: { p_user_ids: string[] }; Returns: undefined }
      rating_projection_eligible_groups: {
        Args: Record<PropertyKey, never>
        Returns: {
          classification: string
          confirmation_id: string
          game_group_id: string
          game_group_number: number
          match_event_id: string
          played_at: string
          proposal_version: number
          teams: Json
        }[]
      }
      rating_projection_initial_state: { Args: { p_level: number }; Returns: Json }
      rating_projection_lock_covered: { Args: Record<PropertyKey, never>; Returns: undefined }
      rating_projection_prelock_sources: { Args: Record<PropertyKey, never>; Returns: undefined }
      rating_projection_replay: {
        Args: { p_context?: Json; p_revision: number }
        Returns: Record<string, unknown>
      }
      rating_projection_write_states: {
        Args: { p_meta: Json; p_revision: number; p_states: Json }
        Returns: number
      }
      rating_read_actor: { Args: Record<PropertyKey, never>; Returns: string }
      rating_read_assert_revision: {
        Args: { p_committed: number; p_revision: number }
        Returns: undefined
      }
      rating_summary_at: { Args: { p_revision: number; p_user_id: string }; Returns: Json }
      rating_timeline_items: {
        Args: { p_revision: number; p_user_id: string }
        Returns: {
          display_level: number
          dto: Json
          effective_at: string
          item_id: string
          kind: string
          sort_at: string
          sort_id: string
          sort_rank: number
          sort_rev: number
        }[]
      }
      rating_utc_text: { Args: { p_instant: string }; Returns: string }
      rating_v1_calculate_group: {
        Args: {
          p_config_version: number
          p_engine: string
          p_engine_version: string
          p_inputs: Json
        }
        Returns: {
          after_confirmed_groups: number
          after_display_level: number
          after_highest_display_level: number
          after_mu: number
          after_reliability_percent: number
          after_sigma: number
          applied_delta: number
          before_confirmed_groups: number
          before_display_level: number
          before_highest_display_level: number
          before_mu: number
          before_reliability_percent: number
          before_sigma: number
          clamped: boolean
          expected_score: number
          last_rating_at: string
          opponent_team_strength: number
          ordinal: number
          outcome_value: number
          own_team_strength: number
          rating_config_version: number
          rating_engine: string
          rating_engine_version: string
          raw_delta: number
          reliability_factor: number
          rounded_delta: number
          team: string
          user_id: string
        }[]
      }
      rating_v1_calculate_group_curve: {
        Args: {
          p_config_version: number
          p_engine: string
          p_engine_version: string
          p_inputs: Json
        }
        Returns: {
          after_confirmed_groups: number
          after_display_level: number
          after_highest_display_level: number
          after_mu: number
          after_reliability_percent: number
          after_sigma: number
          applied_delta: number
          before_confirmed_groups: number
          before_display_level: number
          before_highest_display_level: number
          before_mu: number
          before_reliability_percent: number
          before_sigma: number
          clamped: boolean
          expected_score: number
          last_rating_at: string
          opponent_team_strength: number
          ordinal: number
          outcome_value: number
          own_team_strength: number
          rating_config_version: number
          rating_engine: string
          rating_engine_version: string
          raw_delta: number
          reliability_factor: number
          rounded_delta: number
          team: string
          user_id: string
        }[]
      }
      rating_v1_calculate_group_exception: {
        Args: {
          p_config_version: number
          p_engine: string
          p_engine_version: string
          p_inputs: Json
        }
        Returns: {
          after_confirmed_groups: number
          after_display_level: number
          after_highest_display_level: number
          after_mu: number
          after_reliability_percent: number
          after_sigma: number
          applied_delta: number
          before_confirmed_groups: number
          before_display_level: number
          before_highest_display_level: number
          before_mu: number
          before_reliability_percent: number
          before_sigma: number
          clamped: boolean
          expected_score: number
          last_rating_at: string
          opponent_team_strength: number
          ordinal: number
          outcome_value: number
          own_team_strength: number
          rating_config_version: number
          rating_engine: string
          rating_engine_version: string
          raw_delta: number
          reliability_factor: number
          rounded_delta: number
          team: string
          user_id: string
        }[]
      }
      rating_v1_exception_supports: {
        Args: { p_config_version: number; p_engine: string; p_engine_version: string }
        Returns: boolean
      }
      rating_v1_is_ratable: {
        Args: { p_classification: string; p_match_type: string; p_result_status: string }
        Returns: boolean
      }
      rating_v1_supports: {
        Args: { p_config_version: number; p_engine: string; p_engine_version: string }
        Returns: boolean
      }
      rebuild_league_counters: { Args: { p_league_id: string }; Returns: Json }
      rebuild_statistics: { Args: { p_community_id?: string }; Returns: Json }
      reconcile_match_registration_participation:
        | { Args: { p_accepted_registration_id?: string; p_match_event_id: string }; Returns: Json }
        | {
            Args: {
              p_accepted_registration_id: string
              p_before_roster: Json
              p_match_event_id: string
            }
            Returns: Json
          }
      reconfirm_match_registration: {
        Args: {
          p_attempt_id: string
          p_generation: number
          p_match_event_id: string
          p_request_id: string
        }
        Returns: Json
      }
      record_match_result_alert_attempt: {
        Args: {
          p_candidate_id: string
          p_failed: boolean
          p_failure_code?: string
          p_kind: string
          p_version: number
        }
        Returns: undefined
      }
      record_match_result_alert_fallback: {
        Args: { p_candidate_id: string; p_failure_code: string; p_kind: string; p_version: number }
        Returns: undefined
      }
      record_match_result_processing_attempt: {
        Args: {
          p_clear_failure?: boolean
          p_failed: boolean
          p_failure_code?: string
          p_proposal_id: string
          p_version: number
        }
        Returns: boolean
      }
      record_result_amendment_event: {
        Args: {
          p_actor: string
          p_amendment: Omit<
            Database["public"]["Tables"]["result_amendment_requests"]["Row"],
            Database["public"]["Tables"]["result_amendment_requests"]["ComputedFields"]
          >
          p_candidate_version: number
          p_command_id: string
          p_data: Json
          p_event_type: string
          p_from: string
          p_now: string
          p_source: string
          p_to: string
        }
        Returns: undefined
      }
      record_result_dispute_audit: {
        Args: {
          p_now: string
          x: Omit<
            Database["public"]["Tables"]["result_dispute_resolutions"]["Row"],
            Database["public"]["Tables"]["result_dispute_resolutions"]["ComputedFields"]
          >
        }
        Returns: undefined
      }
      record_result_repair_audit: {
        Args: {
          j: Omit<
            Database["public"]["Tables"]["result_repair_jobs"]["Row"],
            Database["public"]["Tables"]["result_repair_jobs"]["ComputedFields"]
          >
          p_action: string
          p_actor: string
          p_data: Json
        }
        Returns: undefined
      }
      remove_match_registration: {
        Args: {
          p_attempt_id: string
          p_match_event_id: string
          p_reason: string
          p_request_id: string
          p_target_user_id: string
        }
        Returns: Json
      }
      request_result_amendment: {
        Args: {
          p_command_id: string
          p_expected_confirmation_id: string
          p_proposal_id: string
          p_reason: string
        }
        Returns: Json
      }
      resolve_level_review_request: {
        Args: {
          p_command_id: string
          p_decision: string
          p_exception_justification?: string
          p_expected_revision?: number
          p_note: string
          p_reliability_mode?: string
          p_reliability_target?: number
          p_request_id: string
          p_target_level?: number
        }
        Returns: Json
      }
      resolve_result_dispute: {
        Args: {
          p_command_id: string
          p_decision: string
          p_expected_base_confirmation_id?: string
          p_expected_candidate_version: number
          p_justification: string
          p_proposal_id: string
        }
        Returns: Json
      }
      respond_match_event_invitation: {
        Args: { p_invitation_id: string; p_match_event_id: string; p_response: string }
        Returns: Json
      }
      result_amendment_actor: { Args: Record<PropertyKey, never>; Returns: string }
      result_amendment_dto: {
        Args: {
          p_viewer: string
          r: Omit<
            Database["public"]["Tables"]["result_amendment_requests"]["Row"],
            Database["public"]["Tables"]["result_amendment_requests"]["ComputedFields"]
          >
        }
        Returns: Json
      }
      result_amendment_reader: {
        Args: { p_base_version: number; p_match_event_id: string; p_proposal_id: string }
        Returns: boolean
      }
      result_amendment_receipt: {
        Args: {
          p_command_id: string
          p_replayed: boolean
          r: Omit<
            Database["public"]["Tables"]["result_amendment_requests"]["Row"],
            Database["public"]["Tables"]["result_amendment_requests"]["ComputedFields"]
          >
        }
        Returns: Json
      }
      result_dispute_event_reader: { Args: { p_match_event_id: string }; Returns: boolean }
      result_dispute_receipt: {
        Args: {
          p_command_id: string
          p_replayed: boolean
          x: Omit<
            Database["public"]["Tables"]["result_dispute_resolutions"]["Row"],
            Database["public"]["Tables"]["result_dispute_resolutions"]["ComputedFields"]
          >
        }
        Returns: Json
      }
      result_dispute_resolution_dto: {
        Args: {
          x: Omit<
            Database["public"]["Tables"]["result_dispute_resolutions"]["Row"],
            Database["public"]["Tables"]["result_dispute_resolutions"]["ComputedFields"]
          >
        }
        Returns: Json
      }
      result_repair_apply_fact_locked: {
        Args: { p_job_id: string; p_revision: number }
        Returns: Json
      }
      result_repair_authorized: { Args: { p_community_id: string }; Returns: boolean }
      result_repair_backoff: { Args: { p_attempt_count: number }; Returns: string }
      result_repair_diagnostics_reader: { Args: { p_community_id: string }; Returns: boolean }
      result_repair_failure_code: { Args: { p_message: string; p_stage: string }; Returns: string }
      result_repair_guard_confirmation: {
        Args: {
          p_new: Omit<
            Database["public"]["Tables"]["match_event_result_confirmations"]["Row"],
            Database["public"]["Tables"]["match_event_result_confirmations"]["ComputedFields"]
          >
        }
        Returns: {
          actor_id: string | null
          confirmed_at: string
          effective_at: string
          event_type: Database["public"]["Enums"]["match_event_type"]
          group_number: number
          id: string
          match_event_id: string
          proposal_id: string
          proposal_version: number
          ratable_eligible: boolean
          source: string
        }
        SetofOptions: {
          from: "match_event_result_confirmations"
          to: "match_event_result_confirmations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      result_repair_job_dto: {
        Args: {
          j: Omit<
            Database["public"]["Tables"]["result_repair_jobs"]["Row"],
            Database["public"]["Tables"]["result_repair_jobs"]["ComputedFields"]
          >
        }
        Returns: Json
      }
      result_repair_lock_league: { Args: { p_job_id: string }; Returns: undefined }
      result_repair_prepare_locked: { Args: { p_job_id: string }; Returns: Json }
      result_repair_publish_derived: {
        Args: { p_job_id: string; p_revision: number }
        Returns: undefined
      }
      result_repair_retryable: { Args: { p_code: string }; Returns: boolean }
      result_repair_scheduler_health: { Args: Record<PropertyKey, never>; Returns: Json }
      retry_result_repair: { Args: { p_job_id: string }; Returns: Json }
      review_match_event_result: {
        Args: {
          p_decision: string
          p_expected_version: number
          p_proposal_id: string
          p_reason_code?: string
          p_reason_note?: string
          p_request_id?: string
        }
        Returns: Json
      }
      review_result_amendment: {
        Args: {
          p_amendment_id: string
          p_command_id: string
          p_decision: string
          p_expected_base_confirmation_id: string
          p_expected_candidate_version: number
          p_reason_code?: string
          p_reason_note?: string
        }
        Returns: Json
      }
      run_claimed_result_repairs: { Args: { p_limit?: number }; Returns: Json }
      safe_match_photo_uuid: { Args: { p_value: string }; Returns: string }
      safe_venue_photo_uuid: { Args: { p_value: string }; Returns: string }
      search_community_invitees: {
        Args: { p_community_id: string; p_limit?: number; p_query: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      search_community_members: {
        Args: {
          p_community_id: string
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_status?: Database["public"]["Enums"]["community_membership_status"]
        }
        Returns: {
          activated_at: string
          display_level: number
          display_name: string
          membership_id: string
          reliability_percent: number
          role: Database["public"]["Enums"]["community_member_role"]
          status: Database["public"]["Enums"]["community_membership_status"]
          user_id: string
          valid_from: string
          valid_until: string
        }[]
      }
      search_match_invitees: {
        Args: { p_community_id: string; p_limit: number; p_query: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      send_community_request_message: {
        Args: {
          p_body: string
          p_client_request_id: string
          p_community_id: string
          p_membership_id: string
        }
        Returns: {
          created_at: string
          message_id: string
        }[]
      }
      set_my_notification_preferences: {
        Args: {
          p_push_community: boolean
          p_push_enabled: boolean
          p_push_leagues: boolean
          p_push_matches: boolean
          p_push_rankings: boolean
          p_push_results: boolean
        }
        Returns: {
          critical_in_app_enabled: boolean
          push_community: boolean
          push_enabled: boolean
          push_leagues: boolean
          push_matches: boolean
          push_rankings: boolean
          push_results: boolean
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notification_preferences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_match_player_add: {
        Args: {
          p_actor_id: string
          p_attempt: string
          p_delivered: boolean
          p_match_event_id: string
          p_request_id: string
        }
        Returns: Json
      }
      snapshot_match_registration_roster_locked: { Args: { p_event_id: string }; Returns: Json }
      statistics_apply_summaries: {
        Args: { p_communities: string[]; p_players: string[] }
        Returns: number
      }
      statistics_assert_consistent: { Args: { p_community_id: string }; Returns: undefined }
      statistics_assert_rating_aligned: { Args: Record<PropertyKey, never>; Returns: undefined }
      statistics_can_view_event: {
        Args: { p_event_id: string; p_viewer: string }
        Returns: boolean
      }
      statistics_cand: {
        Args: { p_at: string; p_group: string; p_key: number; p_value: number }
        Returns: Json
      }
      statistics_community_league_groups: {
        Args: {
          p_communities: string[]
          p_from: string
          p_league_ids: string[]
          p_through: string
          p_type: string
        }
        Returns: number
      }
      statistics_community_relation_top: {
        Args: { p_key: string; p_relations: Json }
        Returns: Json
      }
      statistics_community_top: {
        Args: { p_observed: number; p_reason: string; p_required: number; p_rows: Json }
        Returns: Json
      }
      statistics_derive_sets: {
        Args: { p_classification: string; p_sets: Json }
        Returns: {
          deciding_winner: string
          first_set_winner: string
          games_a: number
          games_b: number
          incomplete_decider: boolean
          set_count: number
          sets_a: number
          sets_b: number
          straight_winner: string
          three_set: boolean
        }[]
      }
      statistics_json_add: { Args: { a: Json; b: Json }; Returns: Json }
      statistics_leader_metric: {
        Args: { p_observed: number; p_required: number; p_value: Json }
        Returns: Json
      }
      statistics_lifecycle_rebuild: { Args: { p_community_id?: string }; Returns: undefined }
      statistics_lifecycle_refresh_event: { Args: { p_event_id: string }; Returns: undefined }
      statistics_lock: { Args: Record<PropertyKey, never>; Returns: undefined }
      statistics_matchup_id: {
        Args: { p_first_pair: string; p_second_pair: string }
        Returns: string
      }
      statistics_nil_uuid: { Args: Record<PropertyKey, never>; Returns: string }
      statistics_official_confirmations: {
        Args: { p_game_group_ids?: string[] }
        Returns: {
          confirmation_id: string
          game_group_id: string
          proposal_version: number
        }[]
      }
      statistics_official_groups: {
        Args: { p_game_group_ids?: string[] }
        Returns: {
          audit_event_id: string
          classification: string
          community_id: string
          confirmation_id: string
          confirmation_source: string
          confirmed_at: string
          game_group_id: string
          group_number: number
          league_eligible: boolean
          league_id: string
          match_event_id: string
          match_type: string
          played_at: string
          proposal_version: number
          rating_expected: boolean
          sets: Json
          teams: Json
        }[]
      }
      statistics_pair_id: { Args: { p_first: string; p_second: string }; Returns: string }
      statistics_pending_init: { Args: Record<PropertyKey, never>; Returns: undefined }
      statistics_player_form: {
        Args: { p_capacity: number; p_minimum: number; p_recent: Json }
        Returns: Json
      }
      statistics_player_rank_block: {
        Args: { p_community_id: string; p_league_id: string; p_player_id: string }
        Returns: Json
      }
      statistics_player_ratio: {
        Args: { p_denominator: number; p_minimum: number; p_numerator: number }
        Returns: Json
      }
      statistics_player_sequence_merge: { Args: { a: Json; b: Json }; Returns: Json }
      statistics_player_value: { Args: { p_reason: string; p_value: number }; Returns: Json }
      statistics_project_source: { Args: { p_game_group_ids: string[] }; Returns: number }
      statistics_publish: {
        Args: {
          p_all?: boolean
          p_force_communities?: string[]
          p_force_groups?: string[]
          p_force_players?: string[]
        }
        Returns: Json
      }
      statistics_quartet_id: { Args: { p_players: string[] }; Returns: string }
      statistics_rank_compute: {
        Args: { p_community_id: string }
        Returns: {
          complete: boolean
          display_level: number
          effective_from: string
          established: boolean
          player_id: string
          provenance: Json
          ranked_members: number
          rating_revision: number
          reliability_percent: number
          skill_rank: number
          status: string
        }[]
      }
      statistics_rank_mark_league: { Args: { p_league_id: string }; Returns: undefined }
      statistics_rank_mark_player: {
        Args: { p_cause: string; p_player_id: string }
        Returns: undefined
      }
      statistics_rank_metric: {
        Args: {
          p_denominator: number
          p_numerator: number
          p_reason: string
          p_required: number
          p_state: string
          p_value: Json
        }
        Returns: Json
      }
      statistics_rank_rebuild: { Args: { p_community_id?: string }; Returns: Json }
      statistics_rank_rebuild_community: { Args: { p_community_id: string }; Returns: number }
      statistics_rank_refresh: { Args: Record<PropertyKey, never>; Returns: number }
      statistics_rank_refresh_league: { Args: { p_league_id: string }; Returns: number }
      statistics_rank_value: {
        Args: {
          p_at: string
          p_community: string
          p_league: string
          p_position: number
          p_provenance: string
          p_revision: number
          p_version: number
        }
        Returns: Json
      }
      statistics_rating_rows: {
        Args: { p_game_group_ids: string[]; p_revision: number }
        Returns: {
          after_level: number
          after_rel: number
          before_level: number
          before_rel: number
          calc_revision: number
          delta: number
          expected: number
          game_group_id: string
          opp_strength: number
          own_strength: number
          user_id: string
        }[]
      }
      statistics_read_actor: { Args: Record<PropertyKey, never>; Returns: string }
      statistics_recent: { Args: { p_items: Json }; Returns: Json }
      statistics_relationship_extremum: { Args: { p_candidate: Json }; Returns: Json }
      statistics_relationship_leaders: {
        Args: {
          p_config: Json
          p_key: string
          p_limit: number
          p_offset: number
          p_relations: Json
        }
        Returns: Json
      }
      statistics_relationship_name: { Args: { p_user_id: string }; Returns: Json }
      statistics_relationship_prepare: {
        Args: {
          p_community_id: string
          p_focal: string
          p_from: string
          p_league_id: string
          p_other: string
          p_through: string
          p_type: string
        }
        Returns: Json
      }
      statistics_relationship_record: {
        Args: {
          p_a: string
          p_b: string
          p_config: Json
          p_from: string
          p_kind: string
          p_scope: string
          p_scope_id: string
          p_through: string
          p_type: string
        }
        Returns: Json
      }
      statistics_relationship_relations: {
        Args: {
          p_from: string
          p_player_id: string
          p_scope: string
          p_scope_id: string
          p_through: string
          p_type: string
        }
        Returns: Json
      }
      statistics_seq_from: { Args: { p_outcomes: string }; Returns: Json }
      statistics_thresholds_valid: { Args: { p_thresholds: Json }; Returns: boolean }
      statistics_utc_text: { Args: { p_instant: string }; Returns: string }
      submit_level_review_request: {
        Args: {
          p_command_id: string
          p_evidence?: string
          p_reason: string
          p_requested_max_level: number
          p_requested_min_level: number
        }
        Returns: Json
      }
      submit_match_event_result: {
        Args: {
          p_court_label?: string
          p_group_number: number
          p_match_event_id: string
          p_played_local: Json
          p_request_id?: string
          p_sets: Json
          p_teams: Json
        }
        Returns: Json
      }
      submit_match_registration: { Args: { p_match_event_id: string }; Returns: Json }
      submit_match_registration_locked: {
        Args: { p_actor_id: string; p_match_event_id: string }
        Returns: Json
      }
      submit_result_amendment_candidate: {
        Args: {
          p_amendment_id: string
          p_command_id: string
          p_court_label?: string
          p_expected_base_confirmation_id: string
          p_expected_candidate_version?: number
          p_played_local: Json
          p_sets: Json
          p_teams: Json
        }
        Returns: Json
      }
      transfer_match_event_ownership: {
        Args: {
          p_expected_version: number
          p_match_event_id: string
          p_request_id: string
          p_target_user_id: string
        }
        Returns: Json
      }
      try_auto_accept_result_amendment: {
        Args: { p_amendment_id: string; p_expected_version: number }
        Returns: Json
      }
      try_auto_confirm_match_event_result: {
        Args: { p_expected_version: number; p_proposal_id: string }
        Returns: Json
      }
      try_lock_match_result_processing_state: { Args: { p_proposal_id: string }; Returns: boolean }
      update_community_admin_defaults: {
        Args: { p_community_id: string; p_defaults: Json }
        Returns: Json
      }
      update_community_settings: {
        Args: { p_changes: Json; p_community_id: string }
        Returns: {
          city_label: string
          description: string
          id: string
          join_policy: Database["public"]["Enums"]["community_join_policy"]
          logo_path: string
          name: string
          settings: Json
          updated_at: string
          visibility: Database["public"]["Enums"]["community_visibility"]
        }[]
      }
      update_league: {
        Args: { p_changes: Json; p_expected_version: number; p_league_id: string }
        Returns: Json
      }
      valid_community_admin_defaults: { Args: { p_defaults: Json }; Returns: boolean }
      valid_community_venue_photo_key: { Args: { p_key: string }; Returns: boolean }
      valid_league_timezone: { Args: { p_timezone: string }; Returns: boolean }
      valid_match_maps_url: { Args: { p_url: string }; Returns: boolean }
      valid_match_photo_key: { Args: { p_key: string }; Returns: boolean }
      validate_match_event_result_facts: {
        Args: {
          p_court_label: string
          p_group_number: number
          p_match_event_id: string
          p_played_local: Json
          p_sets: Json
          p_teams: Json
        }
        Returns: Json
      }
      validate_match_result_sets: { Args: { p_sets: Json }; Returns: Json }
      withdraw_match_registration: {
        Args: { p_attempt_id: string; p_match_event_id: string; p_request_id: string }
        Returns: Json
      }
    }
    Enums: {
      community_join_policy: "instant" | "admin_approval"
      community_member_role: "admin" | "member"
      community_membership_status: "active" | "pending" | "inactive"
      community_visibility: "public" | "private"
      league_end_mode: "fixed_date" | "manual"
      league_status: "upcoming" | "active" | "closed"
      level_review_status: "pending" | "under_review" | "approved" | "rejected" | "canceled"
      match_event_type: "competitive" | "friendly"
      match_event_visibility: "community_open" | "invite_only"
      match_invitation_status: "pending" | "accepted" | "declined" | "expired" | "cancelled"
      match_registration_lifecycle:
        | "pending"
        | "accepted"
        | "rejected"
        | "expired"
        | "withdrawn"
        | "removed_by_creator"
      match_registration_participation: "playing" | "reserve" | "reserve_not_playing"
      match_registration_source: "creator" | "member" | "guest"
      match_team_assignment_mode: "PREDEFINED_TEAMS" | "POST_MATCH_TEAMS"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          lifecycle_configuration: Json | null
          lifecycle_configuration_generation: string | null
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
          versioning_status: string
        }
        ComputedFields: never
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          lifecycle_configuration?: Json | null
          lifecycle_configuration_generation?: string | null
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          lifecycle_configuration?: Json | null
          lifecycle_configuration_generation?: string | null
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: NonNullable<Json>
          name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: NonNullable<Json>
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: NonNullable<Json>
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        ComputedFields: never
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          bucket_id: string | null
          created_at: string | null
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        ComputedFields: never
        Insert: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: never
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: never
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        ComputedFields: never
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        ComputedFields: never
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: { Args: { expected_operations: string[] }; Returns: boolean }
      allow_only_operation: { Args: { expected_operation: string }; Returns: boolean }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: { delete_markers?: string; noncurrent_versions?: string }
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
          raw_prefix_param?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delete_markers?: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          next_token_archived_at?: string
          next_token_version?: string
          noncurrent_versions?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      operation: { Args: Record<PropertyKey, never>; Returns: string }
      search: {
        Args: {
          bucketname: string
          delete_markers?: string
          levels?: number
          limits?: number
          noncurrent_versions?: string
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          delete_markers?: string
          noncurrent_versions?: string
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
          p_start_after_version?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          delete_markers?: string
          levels?: number
          limits?: number
          noncurrent_versions?: string
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
          start_after_archived_at?: string
          start_after_is_continuation?: boolean
          start_after_version?: string
        }
        Returns: {
          archived_at: string
          created_at: string
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
          version: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
      community_join_policy: ["instant", "admin_approval"],
      community_member_role: ["admin", "member"],
      community_membership_status: ["active", "pending", "inactive"],
      community_visibility: ["public", "private"],
      league_end_mode: ["fixed_date", "manual"],
      league_status: ["upcoming", "active", "closed"],
      level_review_status: ["pending", "under_review", "approved", "rejected", "canceled"],
      match_event_type: ["competitive", "friendly"],
      match_event_visibility: ["community_open", "invite_only"],
      match_invitation_status: ["pending", "accepted", "declined", "expired", "cancelled"],
      match_registration_lifecycle: [
        "pending",
        "accepted",
        "rejected",
        "expired",
        "withdrawn",
        "removed_by_creator",
      ],
      match_registration_participation: ["playing", "reserve", "reserve_not_playing"],
      match_registration_source: ["creator", "member", "guest"],
      match_team_assignment_mode: ["PREDEFINED_TEAMS", "POST_MATCH_TEAMS"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
