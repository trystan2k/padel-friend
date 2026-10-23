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
          community_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["community_member_role"]
          status: Database["public"]["Enums"]["community_membership_status"]
          user_id: string
          valid_from: string
          valid_until: string | null
        }
        ComputedFields: never
        Insert: {
          activated_at?: string | null
          community_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["community_member_role"]
          status: Database["public"]["Enums"]["community_membership_status"]
          user_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          activated_at?: string | null
          community_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["community_member_role"]
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
      match_event_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after_data: NonNullable<Json>
          before_data: NonNullable<Json>
          changed_fields: string[]
          community_id: string
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
      match_event_result_proposal_versions: {
        Row: {
          classification: string
          court_label: string | null
          played_at_local: string
          played_at_offset_seconds: number
          played_at_utc: string
          proposal_id: string
          sets: NonNullable<Json>
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
          sets: NonNullable<Json>
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
          sets?: NonNullable<Json>
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
            foreignKeyName: "match_events_saved_venue_id_fkey"
            columns: ["saved_venue_id"]
            isOneToOne: false
            referencedRelation: "community_venues"
            referencedColumns: ["id"]
          },
        ]
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
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      player_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string
          dominant_hand: string | null
          preferred_side: string
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
          preferred_side: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          dominant_hand?: string | null
          preferred_side?: string
          updated_at?: string
          user_id?: string
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
      advance_match_registration_revision_locked: { Args: { p_event_id: string }; Returns: number }
      assert_match_event_active_locked: { Args: { p_event_id: string }; Returns: undefined }
      assert_match_management_action_locked: {
        Args: { p_action: string; p_event_id: string }
        Returns: undefined
      }
      can_read_community: { Args: { p_community_id: string }; Returns: boolean }
      can_read_match_event: { Args: { p_event_id: string }; Returns: boolean }
      cancel_match_event: {
        Args: {
          p_expected_version: number
          p_match_event_id: string
          p_reason: string
          p_request_id: string
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
      edit_match_event: {
        Args: {
          p_expected_version: number
          p_match_event_id: string
          p_patch: Json
          p_request_id: string
        }
        Returns: Json
      }
      expire_match_event_invitations_locked: {
        Args: { p_as_of: string; p_event_id: string }
        Returns: number
      }
      finalize_community_venue_photo: {
        Args: { p_community_id: string; p_object_key: string; p_venue_id: string }
        Returns: undefined
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
      get_effective_community_admin_defaults: { Args: { p_settings: Json }; Returns: Json }
      get_match_creation_options: { Args: { p_community_id?: string }; Returns: Json }
      get_match_event: { Args: { p_event_id: string }; Returns: Json }
      get_match_event_management: { Args: { p_match_event_id: string }; Returns: Json }
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
      get_my_notifications_as_of: { Args: Record<PropertyKey, never>; Returns: string }
      govern_community_member: {
        Args: { p_action: string; p_community_id: string; p_membership_id: string }
        Returns: {
          membership_id: string
          role: Database["public"]["Enums"]["community_member_role"]
          status: Database["public"]["Enums"]["community_membership_status"]
        }[]
      }
      is_community_admin: { Args: { p_community_id: string }; Returns: boolean }
      is_community_member: { Args: { p_community_id: string }; Returns: boolean }
      is_private_match_event: { Args: { p_event_id: string }; Returns: boolean }
      join_public_community: {
        Args: { p_community_id: string }
        Returns: {
          community_id: string
          status: Database["public"]["Enums"]["community_membership_status"]
        }[]
      }
      leave_community: {
        Args: { p_community_id: string }
        Returns: {
          community_id: string
          membership_id: string
          status: Database["public"]["Enums"]["community_membership_status"]
          valid_until: string
        }[]
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
      mark_all_notifications_read: { Args: { p_before: string }; Returns: number }
      mark_community_notification_read: {
        Args: { p_notification_id: string }
        Returns: {
          notification_id: string
          read_at: string
        }[]
      }
      mark_notification_read: { Args: { p_notification_id: string }; Returns: string }
      match_event_caller_context: {
        Args: { p_event_id: string }
        Returns: {
          caller_eligibility: string
          caller_is_invited: boolean
          caller_requires_approval: boolean
        }[]
      }
      match_event_local_start: {
        Args: { p_date: string; p_time: string; p_zone: string }
        Returns: string
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
      process_due_match_event_registration_cutoffs: { Args: { p_limit?: number }; Returns: Json }
      process_match_event_registration_cutoff: {
        Args: { p_match_event_id: string; p_skip_locked?: boolean }
        Returns: Json
      }
      protect_match_event_results: { Args: { p_event_id: string }; Returns: undefined }
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
      respond_match_event_invitation: {
        Args: { p_invitation_id: string; p_match_event_id: string; p_response: string }
        Returns: Json
      }
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
      snapshot_match_registration_roster_locked: { Args: { p_event_id: string }; Returns: Json }
      submit_match_registration: { Args: { p_match_event_id: string }; Returns: Json }
      submit_match_registration_locked: {
        Args: { p_actor_id: string; p_match_event_id: string }
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
      valid_community_admin_defaults: { Args: { p_defaults: Json }; Returns: boolean }
      valid_community_venue_photo_key: { Args: { p_key: string }; Returns: boolean }
      valid_match_maps_url: { Args: { p_url: string }; Returns: boolean }
      valid_match_photo_key: { Args: { p_key: string }; Returns: boolean }
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
