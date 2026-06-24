export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounting_mappings: {
        Row: {
          account_code: string
          created_at: string
          description: string | null
          is_active: boolean
          mapping_key: string
          updated_at: string
        }
        Insert: {
          account_code: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          mapping_key: string
          updated_at?: string
        }
        Update: {
          account_code?: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          mapping_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_mappings_account_code_fkey"
            columns: ["account_code"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["code"]
          },
        ]
      }
      accounts: {
        Row: {
          account_class: number
          account_type: string
          balance_type: string
          cash_flow_section: Database["public"]["Enums"]["cash_flow_section"]
          code: string
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          is_postable: boolean
          is_system: boolean
          name: string
          updated_at: string
        }
        Insert: {
          account_class: number
          account_type: string
          balance_type: string
          cash_flow_section?: Database["public"]["Enums"]["cash_flow_section"]
          code: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          is_postable?: boolean
          is_system?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          account_class?: number
          account_type?: string
          balance_type?: string
          cash_flow_section?: Database["public"]["Enums"]["cash_flow_section"]
          code?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          is_postable?: boolean
          is_system?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          metadata: Json | null
          payload: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: number
          metadata?: Json | null
          payload?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: number
          metadata?: Json | null
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_payments: {
        Row: {
          allocation: Json
          amount: number
          created_at: string
          created_by: string
          customer_id: string
          id: string
          idempotency_key: string | null
          journal_entry_id: string | null
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          paid_at: string
          payment_number: string
          reference: string | null
        }
        Insert: {
          allocation?: Json
          amount: number
          created_at?: string
          created_by: string
          customer_id: string
          id?: string
          idempotency_key?: string | null
          journal_entry_id?: string | null
          method: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          payment_number: string
          reference?: string | null
        }
        Update: {
          allocation?: Json
          amount?: number
          created_at?: string
          created_by?: string
          customer_id?: string
          id?: string
          idempotency_key?: string | null
          journal_entry_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          payment_number?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "b2b_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_settings: {
        Row: {
          aging_buckets: Json
          available_payment_terms: Json
          critical_overdue_days: number
          default_payment_terms: string
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          aging_buckets?: Json
          available_payment_terms?: Json
          critical_overdue_days?: number
          default_payment_terms?: string
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          aging_buckets?: Json
          available_payment_terms?: Json
          critical_overdue_days?: number
          default_payment_terms?: string
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "b2b_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      business_config: {
        Row: {
          created_at: string
          currency: string
          fiscal_address: string | null
          id: number
          name: string
          pos_discount_presets: Json
          pos_opening_cash_presets: Json
          pos_quick_payment_amounts: Json
          production_yield_variance_threshold_pct: number
          shift_variance_threshold_abs: number
          shift_variance_threshold_pct: number
          tax_inclusive: boolean
          tax_rate: number
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          fiscal_address?: string | null
          id?: number
          name?: string
          pos_discount_presets?: Json
          pos_opening_cash_presets?: Json
          pos_quick_payment_amounts?: Json
          production_yield_variance_threshold_pct?: number
          shift_variance_threshold_abs?: number
          shift_variance_threshold_pct?: number
          tax_inclusive?: boolean
          tax_rate?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          fiscal_address?: string | null
          id?: number
          name?: string
          pos_discount_presets?: Json
          pos_opening_cash_presets?: Json
          pos_quick_payment_amounts?: Json
          production_yield_variance_threshold_pct?: number
          shift_variance_threshold_abs?: number
          shift_variance_threshold_pct?: number
          tax_inclusive?: boolean
          tax_rate?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      cash_movement_idempotency_keys: {
        Row: {
          created_at: string
          idempotency_key: string
          je_id: string
        }
        Insert: {
          created_at?: string
          idempotency_key: string
          je_id: string
        }
        Update: {
          created_at?: string
          idempotency_key?: string
          je_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movement_idempotency_keys_je_id_fkey"
            columns: ["je_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          direction: string
          id: string
          idempotency_key: string | null
          reason: string
          reason_code: string | null
          session_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          direction: string
          id?: string
          idempotency_key?: string | null
          reason: string
          reason_code?: string | null
          session_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: string
          idempotency_key?: string | null
          reason?: string
          reason_code?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_import_idempotency_keys: {
        Row: {
          created_at: string
          created_by: string | null
          key: string
          report: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          key: string
          report: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          key?: string
          report?: Json
        }
        Relationships: []
      }
      categories: {
        Row: {
          category_type: string
          created_at: string
          deleted_at: string | null
          dispatch_station: string
          id: string
          is_active: boolean
          kds_station: string
          name: string
          show_in_pos: boolean
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_type?: string
          created_at?: string
          deleted_at?: string | null
          dispatch_station?: string
          id?: string
          is_active?: boolean
          kds_station?: string
          name: string
          show_in_pos?: boolean
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_type?: string
          created_at?: string
          deleted_at?: string | null
          dispatch_station?: string
          id?: string
          is_active?: boolean
          kds_station?: string
          name?: string
          show_in_pos?: boolean
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      combo_group_options: {
        Row: {
          component_product_id: string
          created_at: string
          group_id: string
          id: string
          is_default: boolean
          sort_order: number
          surcharge: number
        }
        Insert: {
          component_product_id: string
          created_at?: string
          group_id: string
          id?: string
          is_default?: boolean
          sort_order?: number
          surcharge?: number
        }
        Update: {
          component_product_id?: string
          created_at?: string
          group_id?: string
          id?: string
          is_default?: boolean
          sort_order?: number
          surcharge?: number
        }
        Relationships: [
          {
            foreignKeyName: "combo_group_options_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "combo_group_options_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_group_options_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "combo_group_options_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "combo_group_options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "combo_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_groups: {
        Row: {
          combo_product_id: string
          created_at: string
          group_type: string
          id: string
          is_required: boolean
          max_select: number
          min_select: number
          name: string
          sort_order: number
        }
        Insert: {
          combo_product_id: string
          created_at?: string
          group_type: string
          id?: string
          is_required?: boolean
          max_select?: number
          min_select?: number
          name: string
          sort_order?: number
        }
        Update: {
          combo_product_id?: string
          created_at?: string
          group_type?: string
          id?: string
          is_required?: boolean
          max_select?: number
          min_select?: number
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "combo_groups_combo_product_id_fkey"
            columns: ["combo_product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "combo_groups_combo_product_id_fkey"
            columns: ["combo_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_groups_combo_product_id_fkey"
            columns: ["combo_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "combo_groups_combo_product_id_fkey"
            columns: ["combo_product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      combo_upsert_idempotency_keys: {
        Row: {
          combo_product_id: string
          created_at: string
          key: string
        }
        Insert: {
          combo_product_id: string
          created_at?: string
          key: string
        }
        Update: {
          combo_product_id?: string
          created_at?: string
          key?: string
        }
        Relationships: []
      }
      counter_fire_idempotency_keys: {
        Row: {
          client_uuid: string
          created_at: string
          order_id: string
        }
        Insert: {
          client_uuid: string
          created_at?: string
          order_id: string
        }
        Update: {
          client_uuid?: string
          created_at?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "counter_fire_idempotency_keys_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counter_fire_idempotency_keys_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "view_b2b_invoices"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      customer_categories: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          discount_percentage: number
          icon: string | null
          id: string
          is_active: boolean
          is_default: boolean
          loyalty_enabled: boolean
          name: string
          points_multiplier: number
          price_modifier_type: Database["public"]["Enums"]["price_modifier_type"]
          slug: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          discount_percentage?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          loyalty_enabled?: boolean
          name: string
          points_multiplier?: number
          price_modifier_type?: Database["public"]["Enums"]["price_modifier_type"]
          slug: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          discount_percentage?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          loyalty_enabled?: boolean
          name?: string
          points_multiplier?: number
          price_modifier_type?: Database["public"]["Enums"]["price_modifier_type"]
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          b2b_company_name: string | null
          b2b_credit_limit: number | null
          b2b_current_balance: number
          b2b_payment_terms_days: number | null
          b2b_tax_id: string | null
          birth_date: string | null
          category_id: string | null
          created_at: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          deleted_at: string | null
          email: string | null
          id: string
          last_visit_at: string | null
          lifetime_points: number
          loyalty_points: number
          marketing_consent: boolean
          name: string
          phone: string | null
          total_spent: number
          total_visits: number
          updated_at: string
        }
        Insert: {
          b2b_company_name?: string | null
          b2b_credit_limit?: number | null
          b2b_current_balance?: number
          b2b_payment_terms_days?: number | null
          b2b_tax_id?: string | null
          birth_date?: string | null
          category_id?: string | null
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          deleted_at?: string | null
          email?: string | null
          id?: string
          last_visit_at?: string | null
          lifetime_points?: number
          loyalty_points?: number
          marketing_consent?: boolean
          name: string
          phone?: string | null
          total_spent?: number
          total_visits?: number
          updated_at?: string
        }
        Update: {
          b2b_company_name?: string | null
          b2b_credit_limit?: number | null
          b2b_current_balance?: number
          b2b_payment_terms_days?: number | null
          b2b_tax_id?: string | null
          birth_date?: string | null
          category_id?: string | null
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          deleted_at?: string | null
          email?: string | null
          id?: string
          last_visit_at?: string | null
          lifetime_points?: number
          loyalty_points?: number
          marketing_consent?: boolean
          name?: string
          phone?: string | null
          total_spent?: number
          total_visits?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "customer_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_templates: {
        Row: {
          cashier_max_percentage: number | null
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          requires_pin: boolean
          type: Database["public"]["Enums"]["discount_template_type"]
          updated_at: string
          value: number
        }
        Insert: {
          cashier_max_percentage?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          requires_pin?: boolean
          type: Database["public"]["Enums"]["discount_template_type"]
          updated_at?: string
          value: number
        }
        Update: {
          cashier_max_percentage?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          requires_pin?: boolean
          type?: Database["public"]["Enums"]["discount_template_type"]
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      display_movements: {
        Row: {
          created_at: string
          created_by: string
          id: string
          idempotency_key: string | null
          movement_type: Database["public"]["Enums"]["display_movement_type"]
          product_id: string
          quantity: number
          reason: string | null
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          idempotency_key?: string | null
          movement_type: Database["public"]["Enums"]["display_movement_type"]
          product_id: string
          quantity: number
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string | null
          movement_type?: Database["public"]["Enums"]["display_movement_type"]
          product_id?: string
          quantity?: number
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "display_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "display_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "display_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "display_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "display_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      display_screens: {
        Row: {
          code: string
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          last_seen_at: string | null
          location: string | null
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          location?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          location?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      display_stock: {
        Row: {
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          product_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "display_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "display_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "display_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "display_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      edge_function_rate_limits: {
        Row: {
          bucket_key: string
          function_name: string
          id: number
          ip_address: string
          request_count: number
          window_end: string
          window_start: string
        }
        Insert: {
          bucket_key: string
          function_name: string
          id?: number
          ip_address: string
          request_count?: number
          window_end: string
          window_start?: string
        }
        Update: {
          bucket_key?: string
          function_name?: string
          id?: number
          ip_address?: string
          request_count?: number
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body_html: string
          body_text: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          subject: string
          updated_at: string
          variables: Json
        }
        Insert: {
          body_html: string
          body_text: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          subject: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          body_html?: string
          body_text?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          subject?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
      expense_approval_thresholds: {
        Row: {
          amount_max: number
          amount_min: number
          category_id: string | null
          created_at: string
          id: string
          steps: Json
          updated_at: string
        }
        Insert: {
          amount_max: number
          amount_min?: number
          category_id?: string | null
          created_at?: string
          id?: string
          steps: Json
          updated_at?: string
        }
        Update: {
          amount_max?: number
          amount_min?: number
          category_id?: string | null
          created_at?: string
          id?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_approval_thresholds_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_approvals: {
        Row: {
          approved_at: string
          approver_user_id: string
          expense_id: string
          id: string
          step: number
        }
        Insert: {
          approved_at?: string
          approver_user_id: string
          expense_id: string
          id?: string
          step: number
        }
        Update: {
          approved_at?: string
          approver_user_id?: string
          expense_id?: string
          id?: string
          step?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_approvals_approver_user_id_fkey"
            columns: ["approver_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_approvals_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          account_id: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          auto_approved: boolean
          category_id: string
          created_at: string
          created_by: string | null
          current_approval_step: number
          deleted_at: string | null
          description: string
          expense_date: string
          expense_number: string
          id: string
          idempotency_key: string | null
          je_id: string | null
          paid_at: string | null
          paid_by: string | null
          payment_je_id: string | null
          payment_method: string
          receipt_url: string | null
          rejected_at: string | null
          rejected_reason: string | null
          required_approval_steps_snapshot: Json | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
          vat_amount: number
          vendor_name: string | null
        }
        Insert: {
          amount: number
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          category_id: string
          created_at?: string
          created_by?: string | null
          current_approval_step?: number
          deleted_at?: string | null
          description: string
          expense_date?: string
          expense_number: string
          id?: string
          idempotency_key?: string | null
          je_id?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_je_id?: string | null
          payment_method: string
          receipt_url?: string | null
          rejected_at?: string | null
          rejected_reason?: string | null
          required_approval_steps_snapshot?: Json | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          vat_amount?: number
          vendor_name?: string | null
        }
        Update: {
          amount?: number
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          category_id?: string
          created_at?: string
          created_by?: string | null
          current_approval_step?: number
          deleted_at?: string | null
          description?: string
          expense_date?: string
          expense_number?: string
          id?: string
          idempotency_key?: string | null
          je_id?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_je_id?: string | null
          payment_method?: string
          receipt_url?: string | null
          rejected_at?: string | null
          rejected_reason?: string | null
          required_approval_steps_snapshot?: Json | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          vat_amount?: number
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_je_id_fkey"
            columns: ["je_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_payment_je_id_fkey"
            columns: ["payment_je_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          locked_at: string | null
          locked_by: string | null
          notes: string | null
          period_end: string
          period_start: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          period_end: string
          period_start: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          period_end?: string
          period_start?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_periods_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_periods_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_notes: {
        Row: {
          created_at: string
          grn_number: string
          id: string
          idempotency_key: string | null
          metadata: Json
          notes: string | null
          payment_terms: string
          po_id: string
          received_by: string | null
          received_date: string
          subtotal: number
          total: number
          vat_amount: number
        }
        Insert: {
          created_at?: string
          grn_number: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          notes?: string | null
          payment_terms?: string
          po_id: string
          received_by?: string | null
          received_date?: string
          subtotal: number
          total: number
          vat_amount: number
        }
        Update: {
          created_at?: string
          grn_number?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          notes?: string | null
          payment_terms?: string
          po_id?: string
          received_by?: string | null
          received_date?: string
          subtotal?: number
          total?: number
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_notes_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      held_order_idempotency_keys: {
        Row: {
          client_uuid: string
          created_at: string
          order_id: string
        }
        Insert: {
          client_uuid: string
          created_at?: string
          order_id: string
        }
        Update: {
          client_uuid?: string
          created_at?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "held_order_idempotency_keys_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_order_idempotency_keys_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "view_b2b_invoices"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          date: string
          deleted_at: string | null
          id: string
          is_recurring: boolean
          name: string
          notes: string | null
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          deleted_at?: string | null
          id?: string
          is_recurring?: boolean
          name: string
          notes?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          deleted_at?: string | null
          id?: string
          is_recurring?: boolean
          name?: string
          notes?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_master_data_idempotency_keys: {
        Row: {
          created_at: string
          created_by: string | null
          entity: string
          key: string
          report: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entity: string
          key: string
          report: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entity?: string
          key?: string
          report?: Json
        }
        Relationships: []
      }
      internal_transfers: {
        Row: {
          approved_by: string | null
          created_at: string
          created_by: string
          created_idempotency_key: string | null
          from_section_id: string
          id: string
          metadata: Json
          notes: string | null
          received_at: string | null
          received_idempotency_key: string | null
          status: string
          to_section_id: string
          transfer_number: string
          transferred_at: string | null
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          created_by: string
          created_idempotency_key?: string | null
          from_section_id: string
          id?: string
          metadata?: Json
          notes?: string | null
          received_at?: string | null
          received_idempotency_key?: string | null
          status?: string
          to_section_id: string
          transfer_number: string
          transferred_at?: string | null
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          created_by?: string
          created_idempotency_key?: string | null
          from_section_id?: string
          id?: string
          metadata?: Json
          notes?: string | null
          received_at?: string | null
          received_idempotency_key?: string | null
          status?: string
          to_section_id?: string
          transfer_number?: string
          transferred_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_transfers_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_transfers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_transfers_from_section_id_fkey"
            columns: ["from_section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_transfers_to_section_id_fkey"
            columns: ["to_section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_items: {
        Row: {
          count_id: string
          counted_qty: number | null
          created_at: string
          expected_qty: number
          id: string
          movement_id: string | null
          notes: string | null
          product_id: string
          unit: string
          updated_at: string
          variance: number | null
        }
        Insert: {
          count_id: string
          counted_qty?: number | null
          created_at?: string
          expected_qty?: number
          id?: string
          movement_id?: string | null
          notes?: string | null
          product_id: string
          unit: string
          updated_at?: string
          variance?: number | null
        }
        Update: {
          count_id?: string
          counted_qty?: number | null
          created_at?: string
          expected_qty?: number
          id?: string
          movement_id?: string | null
          notes?: string | null
          product_id?: string
          unit?: string
          updated_at?: string
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_items_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      inventory_counts: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          count_number: string
          created_at: string
          created_by: string
          finalized_at: string | null
          finalized_by: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          notes: string | null
          section_id: string
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          count_number: string
          created_at?: string
          created_by: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          notes?: string | null
          section_id: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          count_number?: string
          created_at?: string
          created_by?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          notes?: string | null
          section_id?: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_counts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_counts_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_counts_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          entry_date: string
          entry_number: string
          id: string
          metadata: Json
          reference_id: string | null
          reference_type: string | null
          status: string
          total_credit: number
          total_debit: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date: string
          entry_number: string
          id?: string
          metadata?: Json
          reference_id?: string | null
          reference_type?: string | null
          status?: string
          total_credit?: number
          total_debit?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_number?: string
          id?: string
          metadata?: Json
          reference_id?: string | null
          reference_type?: string | null
          status?: string
          total_credit?: number
          total_debit?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_lines: {
        Row: {
          account_id: string
          created_at: string
          credit: number
          debit: number
          description: string | null
          id: string
          journal_entry_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_sequences: {
        Row: {
          created_at: string
          date: string
          last_number: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          last_number?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          last_number?: number
          updated_at?: string
        }
        Relationships: []
      }
      kiosk_jwt_signing_keys: {
        Row: {
          created_by: string | null
          id: string
          is_active: boolean
          key_id: string
          notes: string | null
          rotated_in_at: string
          rotated_out_at: string | null
          scope: string
        }
        Insert: {
          created_by?: string | null
          id?: string
          is_active?: boolean
          key_id: string
          notes?: string | null
          rotated_in_at?: string
          rotated_out_at?: string | null
          scope: string
        }
        Update: {
          created_by?: string | null
          id?: string
          is_active?: boolean
          key_id?: string
          notes?: string | null
          rotated_in_at?: string
          rotated_out_at?: string | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "kiosk_jwt_signing_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lan_devices: {
        Row: {
          capabilities: Json
          code: string
          created_at: string
          deleted_at: string | null
          device_type: string
          id: string
          ip_address: unknown
          is_active: boolean
          last_heartbeat_at: string | null
          location: string | null
          name: string
          port: number | null
          updated_at: string
        }
        Insert: {
          capabilities?: Json
          code: string
          created_at?: string
          deleted_at?: string | null
          device_type: string
          id?: string
          ip_address?: unknown
          is_active?: boolean
          last_heartbeat_at?: string | null
          location?: string | null
          name: string
          port?: number | null
          updated_at?: string
        }
        Update: {
          capabilities?: Json
          code?: string
          created_at?: string
          deleted_at?: string | null
          device_type?: string
          id?: string
          ip_address?: unknown
          is_active?: boolean
          last_heartbeat_at?: string | null
          location?: string | null
          name?: string
          port?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          description: string
          id: string
          order_amount: number | null
          order_id: string | null
          points: number
          points_balance_after: number
          transaction_type: Database["public"]["Enums"]["loyalty_txn_type"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          description: string
          id?: string
          order_amount?: number | null
          order_id?: string | null
          points: number
          points_balance_after: number
          transaction_type: Database["public"]["Enums"]["loyalty_txn_type"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          description?: string
          id?: string
          order_amount?: number | null
          order_id?: string | null
          points?: number
          points_balance_after?: number
          transaction_type?: Database["public"]["Enums"]["loyalty_txn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "view_b2b_invoices"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      margin_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          computed_at: string
          cost_per_unit: number
          created_at: string
          delta_pct: number
          expected_margin_pct: number
          id: string
          notes: string | null
          product_id: string
          selling_price: number
          target_margin_pct: number
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          computed_at?: string
          cost_per_unit: number
          created_at?: string
          delta_pct: number
          expected_margin_pct: number
          id?: string
          notes?: string | null
          product_id: string
          selling_price: number
          target_margin_pct: number
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          computed_at?: string
          cost_per_unit?: number
          created_at?: string
          delta_pct?: number
          expected_margin_pct?: number
          id?: string
          notes?: string | null
          product_id?: string
          selling_price?: number
          target_margin_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "margin_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "margin_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "margin_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "margin_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "margin_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          body: string
          channel: string
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string | null
          provider_message_id: string | null
          recipient: string
          retries: number
          scheduled_for: string
          sent_at: string | null
          status: string
          subject: string | null
          template_code: string
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          provider_message_id?: string | null
          recipient: string
          retries?: number
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_code: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          provider_message_id?: string | null
          recipient?: string
          retries?: number
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_template_code_fkey"
            columns: ["template_code"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["code"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body_template: string
          channel: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          subject_template: string | null
          updated_at: string
          variables: Json
        }
        Insert: {
          body_template: string
          channel: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          subject_template?: string | null
          updated_at?: string
          variables?: Json
        }
        Update: {
          body_template?: string
          channel?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          subject_template?: string | null
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
      order_edit_idempotency_keys: {
        Row: {
          action: string
          created_at: string
          key: string
          order_id: string
          result: Json
        }
        Insert: {
          action: string
          created_at?: string
          key: string
          order_id: string
          result: Json
        }
        Update: {
          action?: string
          created_at?: string
          key?: string
          order_id?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "order_edit_idempotency_keys_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_edit_idempotency_keys_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "view_b2b_invoices"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      order_items: {
        Row: {
          bumped_at: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          combo_components: Json | null
          created_at: string
          discount_amount: number
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          dispatch_station: string | null
          id: string
          is_cancelled: boolean
          is_locked: boolean
          is_promo_gift: boolean
          kitchen_status: string
          line_total: number
          modifier_ingredients_deducted: Json | null
          modifiers: Json
          modifiers_total: number
          name_snapshot: string
          order_id: string
          prep_started_at: string | null
          product_id: string
          promotion_id: string | null
          quantity: number
          ready_at: string | null
          sent_to_kitchen_at: string | null
          served_at: string | null
          served_by: string | null
          unit_price: number
        }
        Insert: {
          bumped_at?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          combo_components?: Json | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          discount_type?: string | null
          discount_value?: number | null
          dispatch_station?: string | null
          id?: string
          is_cancelled?: boolean
          is_locked?: boolean
          is_promo_gift?: boolean
          kitchen_status?: string
          line_total: number
          modifier_ingredients_deducted?: Json | null
          modifiers?: Json
          modifiers_total?: number
          name_snapshot: string
          order_id: string
          prep_started_at?: string | null
          product_id: string
          promotion_id?: string | null
          quantity: number
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          served_at?: string | null
          served_by?: string | null
          unit_price: number
        }
        Update: {
          bumped_at?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          combo_components?: Json | null
          created_at?: string
          discount_amount?: number
          discount_reason?: string | null
          discount_type?: string | null
          discount_value?: number | null
          dispatch_station?: string | null
          id?: string
          is_cancelled?: boolean
          is_locked?: boolean
          is_promo_gift?: boolean
          kitchen_status?: string
          line_total?: number
          modifier_ingredients_deducted?: Json | null
          modifiers?: Json
          modifiers_total?: number
          name_snapshot?: string
          order_id?: string
          prep_started_at?: string | null
          product_id?: string
          promotion_id?: string | null
          quantity?: number
          ready_at?: string | null
          sent_to_kitchen_at?: string | null
          served_at?: string | null
          served_by?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "view_b2b_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_served_by_fkey"
            columns: ["served_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_payments: {
        Row: {
          amount: number
          cash_received: number | null
          change_given: number | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          paid_at: string
          reference: string | null
        }
        Insert: {
          amount: number
          cash_received?: number | null
          change_given?: number | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          paid_at?: string
          reference?: string | null
        }
        Update: {
          amount?: number
          cash_received?: number | null
          change_given?: number | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          order_id?: string
          paid_at?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "view_b2b_invoices"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      order_sequences: {
        Row: {
          date: string
          last_number: number
        }
        Insert: {
          date: string
          last_number?: number
        }
        Update: {
          date?: string
          last_number?: number
        }
        Relationships: []
      }
      orders: {
        Row: {
          created_at: string
          created_via: string
          customer_id: string | null
          discount_amount: number
          discount_authorized_by: string | null
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          id: string
          idempotency_key: string | null
          is_held: boolean
          loyalty_points_earned: number
          loyalty_points_redeemed: number
          loyalty_redemption_amount: number
          notes: string | null
          order_number: string
          order_type: Database["public"]["Enums"]["order_type"]
          paid_at: string | null
          promotion_total: number
          sent_to_kitchen_at: string | null
          served_by: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          table_number: string | null
          tax_amount: number
          total: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          waiter_id: string | null
        }
        Insert: {
          created_at?: string
          created_via?: string
          customer_id?: string | null
          discount_amount?: number
          discount_authorized_by?: string | null
          discount_reason?: string | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          idempotency_key?: string | null
          is_held?: boolean
          loyalty_points_earned?: number
          loyalty_points_redeemed?: number
          loyalty_redemption_amount?: number
          notes?: string | null
          order_number: string
          order_type?: Database["public"]["Enums"]["order_type"]
          paid_at?: string | null
          promotion_total?: number
          sent_to_kitchen_at?: string | null
          served_by?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal: number
          table_number?: string | null
          tax_amount: number
          total: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          waiter_id?: string | null
        }
        Update: {
          created_at?: string
          created_via?: string
          customer_id?: string | null
          discount_amount?: number
          discount_authorized_by?: string | null
          discount_reason?: string | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          idempotency_key?: string | null
          is_held?: boolean
          loyalty_points_earned?: number
          loyalty_points_redeemed?: number
          loyalty_redemption_amount?: number
          notes?: string | null
          order_number?: string
          order_type?: Database["public"]["Enums"]["order_type"]
          paid_at?: string | null
          promotion_total?: number
          sent_to_kitchen_at?: string | null
          served_by?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          table_number?: string | null
          tax_amount?: number
          total?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          waiter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_discount_authorized_by_fkey"
            columns: ["discount_authorized_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_served_by_fkey"
            columns: ["served_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          action: string
          code: string
          created_at: string
          description: string | null
          module: string
        }
        Insert: {
          action: string
          code: string
          created_at?: string
          description?: string | null
          module: string
        }
        Update: {
          action?: string
          code?: string
          created_at?: string
          description?: string | null
          module?: string
        }
        Relationships: []
      }
      pos_sessions: {
        Row: {
          cash_in_total: number
          cash_out_total: number
          closed_at: string | null
          closed_by: string | null
          closing_cash: number | null
          closing_notes: string | null
          expected_cash: number | null
          id: string
          opened_at: string
          opened_by: string
          opening_cash: number
          opening_notes: string | null
          status: Database["public"]["Enums"]["shift_status"]
          terminal_id: string | null
          variance_total: number | null
        }
        Insert: {
          cash_in_total?: number
          cash_out_total?: number
          closed_at?: string | null
          closed_by?: string | null
          closing_cash?: number | null
          closing_notes?: string | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opened_by: string
          opening_cash: number
          opening_notes?: string | null
          status?: Database["public"]["Enums"]["shift_status"]
          terminal_id?: string | null
          variance_total?: number | null
        }
        Update: {
          cash_in_total?: number
          cash_out_total?: number
          closed_at?: string | null
          closed_by?: string | null
          closing_cash?: number | null
          closing_notes?: string | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opened_by?: string
          opening_cash?: number
          opening_notes?: string | null
          status?: Database["public"]["Enums"]["shift_status"]
          terminal_id?: string | null
          variance_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sessions_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "lan_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      print_queue: {
        Row: {
          created_at: string
          device_id: string | null
          error_message: string | null
          id: string
          payload: Json
          printed_at: string | null
          priority: number
          queued_at: string
          reference_id: string | null
          reference_type: string | null
          retries: number
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          error_message?: string | null
          id?: string
          payload: Json
          printed_at?: string | null
          priority?: number
          queued_at?: string
          reference_id?: string | null
          reference_type?: string | null
          retries?: number
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          error_message?: string | null
          id?: string
          payload?: Json
          printed_at?: string | null
          priority?: number
          queued_at?: string
          reference_id?: string | null
          reference_type?: string | null
          retries?: number
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_queue_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "lan_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      product_category_prices: {
        Row: {
          created_at: string
          customer_category_id: string
          price: number
          product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_category_id: string
          price: number
          product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_category_id?: string
          price?: number
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_category_prices_customer_category_id_fkey"
            columns: ["customer_category_id"]
            isOneToOne: false
            referencedRelation: "customer_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_category_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_category_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_category_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_category_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_modifiers: {
        Row: {
          category_id: string | null
          created_at: string
          deleted_at: string | null
          group_name: string
          group_required: boolean
          group_sort_order: number
          group_type: Database["public"]["Enums"]["modifier_group_type"]
          id: string
          ingredients_to_deduct: Json
          is_active: boolean
          is_default: boolean
          option_icon: string | null
          option_label: string
          option_sort_order: number
          price_adjustment: number
          product_id: string | null
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          group_name: string
          group_required?: boolean
          group_sort_order?: number
          group_type?: Database["public"]["Enums"]["modifier_group_type"]
          id?: string
          ingredients_to_deduct?: Json
          is_active?: boolean
          is_default?: boolean
          option_icon?: string | null
          option_label: string
          option_sort_order?: number
          price_adjustment?: number
          product_id?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          group_name?: string
          group_required?: boolean
          group_sort_order?: number
          group_type?: Database["public"]["Enums"]["modifier_group_type"]
          id?: string
          ingredients_to_deduct?: Json
          is_active?: boolean
          is_default?: boolean
          option_icon?: string | null
          option_label?: string
          option_sort_order?: number
          price_adjustment?: number
          product_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_modifiers_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_modifiers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_modifiers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_modifiers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_modifiers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_sections: {
        Row: {
          created_at: string
          is_primary: boolean
          product_id: string
          section_id: string
        }
        Insert: {
          created_at?: string
          is_primary?: boolean
          product_id: string
          section_id: string
        }
        Update: {
          created_at?: string
          is_primary?: boolean
          product_id?: string
          section_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_sections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_sections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_sections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_sections_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      product_unit_alternatives: {
        Row: {
          code: string
          created_at: string
          deleted_at: string | null
          display_order: number
          factor_to_base: number
          id: string
          product_id: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          factor_to_base: number
          id?: string
          product_id: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          factor_to_base?: number
          id?: string
          product_id?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_unit_alternatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_unit_alternatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_unit_alternatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_unit_alternatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_unit_contexts: {
        Row: {
          created_at: string
          product_id: string
          purchase_unit: string
          recipe_unit: string
          sales_unit: string
          stock_opname_unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          product_id: string
          purchase_unit: string
          recipe_unit: string
          sales_unit: string
          stock_opname_unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          product_id?: string
          purchase_unit?: string
          recipe_unit?: string
          sales_unit?: string
          stock_opname_unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_unit_contexts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_unit_contexts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_unit_contexts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_unit_contexts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      production_batches: {
        Row: {
          batch_number: string
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          notes: string | null
          scheduled_at: string | null
          staff_id: string | null
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          batch_number: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          scheduled_at?: string | null
          staff_id?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          batch_number?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          scheduled_at?: string | null
          staff_id?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_batches_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      production_records: {
        Row: {
          actual_yield_qty: number | null
          batch_id: string | null
          batch_number: string | null
          created_at: string
          expected_yield_qty: number | null
          id: string
          idempotency_key: string | null
          je_posted: boolean
          materials_breakdown: Json | null
          materials_consumed: boolean
          notes: string | null
          product_id: string
          production_date: string
          production_number: string
          quantity_produced: number
          quantity_waste: number
          recipe_version_id: string | null
          reverted_at: string | null
          reverted_by: string | null
          reverted_reason: string | null
          section_id: string | null
          staff_id: string | null
          stock_updated: boolean
          updated_at: string
          yield_variance_pct: number | null
          yield_variance_reason: string | null
        }
        Insert: {
          actual_yield_qty?: number | null
          batch_id?: string | null
          batch_number?: string | null
          created_at?: string
          expected_yield_qty?: number | null
          id?: string
          idempotency_key?: string | null
          je_posted?: boolean
          materials_breakdown?: Json | null
          materials_consumed?: boolean
          notes?: string | null
          product_id: string
          production_date?: string
          production_number: string
          quantity_produced: number
          quantity_waste?: number
          recipe_version_id?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          section_id?: string | null
          staff_id?: string | null
          stock_updated?: boolean
          updated_at?: string
          yield_variance_pct?: number | null
          yield_variance_reason?: string | null
        }
        Update: {
          actual_yield_qty?: number | null
          batch_id?: string | null
          batch_number?: string | null
          created_at?: string
          expected_yield_qty?: number | null
          id?: string
          idempotency_key?: string | null
          je_posted?: boolean
          materials_breakdown?: Json | null
          materials_consumed?: boolean
          notes?: string | null
          product_id?: string
          production_date?: string
          production_number?: string
          quantity_produced?: number
          quantity_waste?: number
          recipe_version_id?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          section_id?: string | null
          staff_id?: string | null
          stock_updated?: boolean
          updated_at?: string
          yield_variance_pct?: number | null
          yield_variance_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_records_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "production_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_records_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_records_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_records_recipe_version_id_fkey"
            columns: ["recipe_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_reverted_by_fkey"
            columns: ["reverted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      production_schedules: {
        Row: {
          completed_record_id: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          planned_qty: number
          recipe_id: string | null
          scheduled_date: string
          slot: string
          status: string
          updated_at: string
        }
        Insert: {
          completed_record_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          planned_qty: number
          recipe_id?: string | null
          scheduled_date: string
          slot: string
          status?: string
          updated_at?: string
        }
        Update: {
          completed_record_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          planned_qty?: number
          recipe_id?: string | null
          scheduled_date?: string
          slot?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_schedules_completed_record_id_fkey"
            columns: ["completed_record_id"]
            isOneToOne: false
            referencedRelation: "production_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_schedules_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_schedules_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_schedules_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "production_schedules_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      products: {
        Row: {
          allergens: Database["public"]["Enums"]["allergen_type"][]
          available_for_sale: boolean
          category_id: string
          combo_available_from: string | null
          combo_available_to: string | null
          combo_base_price: number | null
          combo_display_order: number
          cost_price: number
          created_at: string
          current_stock: number
          deduct_stock: boolean
          default_shelf_life_hours: number | null
          deleted_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_display_item: boolean
          is_favorite: boolean
          is_semi_finished: boolean
          min_stock_threshold: number
          name: string
          parent_product_id: string | null
          product_type: string
          retail_price: number
          sku: string
          target_gross_margin_pct: number | null
          tax_inclusive: boolean
          track_inventory: boolean
          unit: string
          updated_at: string
          variant_axis: Database["public"]["Enums"]["variant_axis_type"] | null
          variant_label: string | null
          variant_sort_order: number
          visible_on_pos: boolean
          wholesale_price: number | null
        }
        Insert: {
          allergens?: Database["public"]["Enums"]["allergen_type"][]
          available_for_sale?: boolean
          category_id: string
          combo_available_from?: string | null
          combo_available_to?: string | null
          combo_base_price?: number | null
          combo_display_order?: number
          cost_price?: number
          created_at?: string
          current_stock?: number
          deduct_stock?: boolean
          default_shelf_life_hours?: number | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_display_item?: boolean
          is_favorite?: boolean
          is_semi_finished?: boolean
          min_stock_threshold?: number
          name: string
          parent_product_id?: string | null
          product_type?: string
          retail_price: number
          sku: string
          target_gross_margin_pct?: number | null
          tax_inclusive?: boolean
          track_inventory?: boolean
          unit?: string
          updated_at?: string
          variant_axis?: Database["public"]["Enums"]["variant_axis_type"] | null
          variant_label?: string | null
          variant_sort_order?: number
          visible_on_pos?: boolean
          wholesale_price?: number | null
        }
        Update: {
          allergens?: Database["public"]["Enums"]["allergen_type"][]
          available_for_sale?: boolean
          category_id?: string
          combo_available_from?: string | null
          combo_available_to?: string | null
          combo_base_price?: number | null
          combo_display_order?: number
          cost_price?: number
          created_at?: string
          current_stock?: number
          deduct_stock?: boolean
          default_shelf_life_hours?: number | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_display_item?: boolean
          is_favorite?: boolean
          is_semi_finished?: boolean
          min_stock_threshold?: number
          name?: string
          parent_product_id?: string | null
          product_type?: string
          retail_price?: number
          sku?: string
          target_gross_margin_pct?: number | null
          tax_inclusive?: boolean
          track_inventory?: boolean
          unit?: string
          updated_at?: string
          variant_axis?: Database["public"]["Enums"]["variant_axis_type"] | null
          variant_label?: string | null
          variant_sort_order?: number
          visible_on_pos?: boolean
          wholesale_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      promotion_applications: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          order_id: string
          promotion_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          order_id: string
          promotion_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          order_id?: string
          promotion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_applications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_applications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "view_b2b_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "promotion_applications_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          bogo_buy_quantity: number | null
          bogo_get_product_id: string | null
          bogo_get_quantity: number | null
          bogo_reward_discount_pct: number | null
          bogo_reward_product_ids: string[]
          bogo_reward_qty: number | null
          bogo_trigger_product_ids: string[]
          bogo_trigger_qty: number | null
          bundle_price: number | null
          bundle_product_ids: string[] | null
          created_at: string
          customer_category_ids: string[]
          customer_tier_ids: string[]
          day_of_week_mask: number
          deleted_at: string | null
          description: string | null
          discount_value: number | null
          end_at: string | null
          end_hour: number | null
          gift_product_id: string | null
          gift_qty: number
          id: string
          is_active: boolean
          max_discount_amount: number | null
          min_items_total: number
          name: string
          priority: number
          scope: Database["public"]["Enums"]["promotion_scope"] | null
          scope_category_ids: string[]
          scope_product_ids: string[]
          slug: string
          stackable_with_manual: boolean
          stackable_with_promo: boolean
          start_at: string | null
          start_hour: number | null
          threshold_amount: number | null
          threshold_type: string | null
          type: Database["public"]["Enums"]["promotion_type"]
          updated_at: string
        }
        Insert: {
          bogo_buy_quantity?: number | null
          bogo_get_product_id?: string | null
          bogo_get_quantity?: number | null
          bogo_reward_discount_pct?: number | null
          bogo_reward_product_ids?: string[]
          bogo_reward_qty?: number | null
          bogo_trigger_product_ids?: string[]
          bogo_trigger_qty?: number | null
          bundle_price?: number | null
          bundle_product_ids?: string[] | null
          created_at?: string
          customer_category_ids?: string[]
          customer_tier_ids?: string[]
          day_of_week_mask?: number
          deleted_at?: string | null
          description?: string | null
          discount_value?: number | null
          end_at?: string | null
          end_hour?: number | null
          gift_product_id?: string | null
          gift_qty?: number
          id?: string
          is_active?: boolean
          max_discount_amount?: number | null
          min_items_total?: number
          name: string
          priority?: number
          scope?: Database["public"]["Enums"]["promotion_scope"] | null
          scope_category_ids?: string[]
          scope_product_ids?: string[]
          slug: string
          stackable_with_manual?: boolean
          stackable_with_promo?: boolean
          start_at?: string | null
          start_hour?: number | null
          threshold_amount?: number | null
          threshold_type?: string | null
          type: Database["public"]["Enums"]["promotion_type"]
          updated_at?: string
        }
        Update: {
          bogo_buy_quantity?: number | null
          bogo_get_product_id?: string | null
          bogo_get_quantity?: number | null
          bogo_reward_discount_pct?: number | null
          bogo_reward_product_ids?: string[]
          bogo_reward_qty?: number | null
          bogo_trigger_product_ids?: string[]
          bogo_trigger_qty?: number | null
          bundle_price?: number | null
          bundle_product_ids?: string[] | null
          created_at?: string
          customer_category_ids?: string[]
          customer_tier_ids?: string[]
          day_of_week_mask?: number
          deleted_at?: string | null
          description?: string | null
          discount_value?: number | null
          end_at?: string | null
          end_hour?: number | null
          gift_product_id?: string | null
          gift_qty?: number
          id?: string
          is_active?: boolean
          max_discount_amount?: number | null
          min_items_total?: number
          name?: string
          priority?: number
          scope?: Database["public"]["Enums"]["promotion_scope"] | null
          scope_category_ids?: string[]
          scope_product_ids?: string[]
          slug?: string
          stackable_with_manual?: boolean
          stackable_with_promo?: boolean
          start_at?: string | null
          start_hour?: number | null
          threshold_amount?: number | null
          threshold_type?: string | null
          type?: Database["public"]["Enums"]["promotion_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotions_bogo_get_product_id_fkey"
            columns: ["bogo_get_product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "promotions_bogo_get_product_id_fkey"
            columns: ["bogo_get_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_bogo_get_product_id_fkey"
            columns: ["bogo_get_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "promotions_bogo_get_product_id_fkey"
            columns: ["bogo_get_product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "promotions_gift_product_id_fkey"
            columns: ["gift_product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "promotions_gift_product_id_fkey"
            columns: ["gift_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_gift_product_id_fkey"
            columns: ["gift_product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "promotions_gift_product_id_fkey"
            columns: ["gift_product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          po_id: string
          product_id: string
          quantity: number
          received_quantity: number
          subtotal: number | null
          unit: string
          unit_cost: number
          unit_factor_to_base: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          po_id: string
          product_id: string
          quantity: number
          received_quantity?: number
          subtotal?: number | null
          unit: string
          unit_cost: number
          unit_factor_to_base?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          po_id?: string
          product_id?: string
          quantity?: number
          received_quantity?: number
          subtotal?: number | null
          unit?: string
          unit_cost?: number
          unit_factor_to_base?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          expected_date: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          notes: string | null
          order_date: string
          payment_terms: string
          po_number: string
          received_by: string | null
          received_date: string | null
          status: string
          subtotal: number
          supplier_id: string
          total_amount: number
          updated_at: string
          vat_amount: number
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          expected_date?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          notes?: string | null
          order_date?: string
          payment_terms?: string
          po_number: string
          received_by?: string | null
          received_date?: string | null
          status?: string
          subtotal?: number
          supplier_id: string
          total_amount?: number
          updated_at?: string
          vat_amount?: number
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          expected_date?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          notes?: string | null
          order_date?: string
          payment_terms?: string
          po_number?: string
          received_by?: string | null
          received_date?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string
          total_amount?: number
          updated_at?: string
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          idempotency_key: string
          method: string
          paid_at: string
          paid_by: string | null
          purchase_order_id: string
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          idempotency_key: string
          method: string
          paid_at?: string
          paid_by?: string | null
          purchase_order_id: string
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          method?: string
          paid_at?: string
          paid_by?: string | null
          purchase_order_id?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_payments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_templates: {
        Row: {
          created_at: string
          custom_css: string | null
          footer: string | null
          header: string | null
          id: string
          is_default: boolean
          name: string
          paper_size: string
          show_logo: boolean
          show_qr: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_css?: string | null
          footer?: string | null
          header?: string | null
          id?: string
          is_default?: boolean
          name: string
          paper_size: string
          show_logo?: boolean
          show_qr?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_css?: string | null
          footer?: string | null
          header?: string | null
          id?: string
          is_default?: boolean
          name?: string
          paper_size?: string
          show_logo?: boolean
          show_qr?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      recipe_versions: {
        Row: {
          change_note: string | null
          created_at: string
          created_by: string | null
          id: string
          product_id: string
          snapshot: Json
          version_number: number
        }
        Insert: {
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          product_id: string
          snapshot: Json
          version_number: number
        }
        Update: {
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string
          snapshot?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipe_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipe_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      recipes: {
        Row: {
          baker_percentage: number | null
          created_at: string
          deleted_at: string | null
          display_order: number | null
          id: string
          is_active: boolean
          is_baker_percentage: boolean
          material_id: string
          notes: string | null
          product_id: string
          quantity: number
          unit: string
          updated_at: string
        }
        Insert: {
          baker_percentage?: number | null
          created_at?: string
          deleted_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean
          is_baker_percentage?: boolean
          material_id: string
          notes?: string | null
          product_id: string
          quantity: number
          unit: string
          updated_at?: string
        }
        Update: {
          baker_percentage?: number | null
          created_at?: string
          deleted_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean
          is_baker_percentage?: boolean
          material_id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      refund_lines: {
        Row: {
          amount: number
          id: string
          order_item_id: string
          qty: number
          refund_id: string
        }
        Insert: {
          amount: number
          id?: string
          order_item_id: string
          qty: number
          refund_id: string
        }
        Update: {
          amount?: number
          id?: string
          order_item_id?: string
          qty?: number
          refund_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_lines_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_lines_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          reference: string | null
          refund_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          reference?: string | null
          refund_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          reference?: string | null
          refund_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_payments_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_sequences: {
        Row: {
          date: string
          last_number: number
        }
        Insert: {
          date: string
          last_number?: number
        }
        Update: {
          date?: string
          last_number?: number
        }
        Relationships: []
      }
      refunds: {
        Row: {
          authorized_by: string
          created_at: string
          id: string
          idempotency_key: string | null
          is_full_void: boolean
          order_id: string
          reason: string
          refund_number: string
          refunded_by: string
          session_id: string
          tax_refunded: number
          total: number
        }
        Insert: {
          authorized_by: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          is_full_void?: boolean
          order_id: string
          reason: string
          refund_number: string
          refunded_by: string
          session_id: string
          tax_refunded?: number
          total: number
        }
        Update: {
          authorized_by?: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          is_full_void?: boolean
          order_id?: string
          reason?: string
          refund_number?: string
          refunded_by?: string
          session_id?: string
          tax_refunded?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "refunds_authorized_by_fkey"
            columns: ["authorized_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "view_b2b_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "refunds_refunded_by_fkey"
            columns: ["refunded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_tables: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          seats: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          seats?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          seats?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          granted_at: string
          granted_by: string | null
          is_granted: boolean
          permission_code: string
          role_code: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          is_granted?: boolean
          permission_code: string
          role_code: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          is_granted?: boolean
          permission_code?: string
          role_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "role_permissions_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          is_system: boolean
          name: string
          session_timeout_minutes: number
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          is_system?: boolean
          name: string
          session_timeout_minutes?: number
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          is_system?: boolean
          name?: string
          session_timeout_minutes?: number
        }
        Relationships: []
      }
      section_stock: {
        Row: {
          product_id: string
          quantity: number
          section_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          product_id: string
          quantity?: number
          section_id: string
          unit: string
          updated_at?: string
        }
        Update: {
          product_id?: string
          quantity?: number
          section_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "section_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "section_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "section_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "section_stock_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          code: string
          created_at: string
          deleted_at: string | null
          display_order: number
          id: string
          is_active: boolean
          kind: string
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          kind: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_locations: {
        Row: {
          code: string
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          parent_location_id: string | null
          section_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          parent_location_id?: string | null
          section_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          parent_location_id?: string | null
          section_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_locations_parent_location_id_fkey"
            columns: ["parent_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_locations_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_lots: {
        Row: {
          batch_number: string | null
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string | null
          location_id: string | null
          metadata: Json
          product_id: string
          quantity: number
          received_at: string
          status: string
          unit: string
          updated_at: string
        }
        Insert: {
          batch_number?: string | null
          created_at?: string
          expires_at: string
          id?: string
          idempotency_key?: string | null
          location_id?: string | null
          metadata?: Json
          product_id: string
          quantity: number
          received_at?: string
          status?: string
          unit: string
          updated_at?: string
        }
        Update: {
          batch_number?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string | null
          location_id?: string | null
          metadata?: Json
          product_id?: string
          quantity?: number
          received_at?: string
          status?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_lots_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string
          from_section_id: string | null
          id: string
          idempotency_key: string | null
          lot_id: string | null
          metadata: Json
          movement_type: Database["public"]["Enums"]["movement_type"]
          product_id: string
          quantity: number
          reason: string | null
          reference_id: string | null
          reference_type: string
          supplier_id: string | null
          to_section_id: string | null
          unit: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          created_by: string
          from_section_id?: string | null
          id?: string
          idempotency_key?: string | null
          lot_id?: string | null
          metadata?: Json
          movement_type: Database["public"]["Enums"]["movement_type"]
          product_id: string
          quantity: number
          reason?: string | null
          reference_id?: string | null
          reference_type: string
          supplier_id?: string | null
          to_section_id?: string | null
          unit: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string
          from_section_id?: string | null
          id?: string
          idempotency_key?: string | null
          lot_id?: string | null
          metadata?: Json
          movement_type?: Database["public"]["Enums"]["movement_type"]
          product_id?: string
          quantity?: number
          reason?: string | null
          reference_id?: string | null
          reference_type?: string
          supplier_id?: string | null
          to_section_id?: string | null
          unit?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_from_section_id_fkey"
            columns: ["from_section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_section_id_fkey"
            columns: ["to_section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reservations: {
        Row: {
          consumed_at: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          holder_id: string | null
          holder_type: string
          id: string
          idempotency_key: string | null
          notes: string | null
          product_id: string
          quantity: number
          released_at: string | null
          released_reason: string | null
          section_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          holder_id?: string | null
          holder_type: string
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          product_id: string
          quantity: number
          released_at?: string | null
          released_reason?: string | null
          section_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          holder_id?: string | null
          holder_type?: string
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          product_id?: string
          quantity?: number
          released_at?: string | null
          released_reason?: string | null
          section_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_reservations_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          code: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          payment_terms_days: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          payment_terms_days?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          payment_terms_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      tablet_order_idempotency_keys: {
        Row: {
          client_uuid: string
          created_at: string
          order_id: string
        }
        Insert: {
          client_uuid: string
          created_at?: string
          order_id: string
        }
        Update: {
          client_uuid?: string
          created_at?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tablet_order_idempotency_keys_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tablet_order_idempotency_keys_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "view_b2b_invoices"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      transfer_items: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          product_id: string
          quantity_received: number | null
          quantity_requested: number
          transfer_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          quantity_received?: number | null
          quantity_requested: number
          transfer_id: string
          unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          quantity_received?: number | null
          quantity_requested?: number
          transfer_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "internal_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_conversions: {
        Row: {
          created_at: string
          factor: number
          from_unit: string
          notes: string | null
          to_unit: string
        }
        Insert: {
          created_at?: string
          factor: number
          from_unit: string
          notes?: string | null
          to_unit: string
        }
        Update: {
          created_at?: string
          factor?: number
          from_unit?: string
          notes?: string | null
          to_unit?: string
        }
        Relationships: []
      }
      units: {
        Row: {
          code: string
          created_at: string
          dimension: string
          factor_to_canonical: number | null
          is_active: boolean
          label: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          dimension: string
          factor_to_canonical?: number | null
          is_active?: boolean
          label: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          dimension?: string
          factor_to_canonical?: number | null
          is_active?: boolean
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      user_permission_overrides: {
        Row: {
          expires_at: string | null
          granted_at: string
          granted_by: string | null
          is_granted: boolean
          permission_code: string
          reason: string
          user_profile_id: string
        }
        Insert: {
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          is_granted: boolean
          permission_code: string
          reason: string
          user_profile_id: string
        }
        Update: {
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          is_granted?: boolean
          permission_code?: string
          reason?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permission_overrides_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permission_overrides_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "user_permission_overrides_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          auth_user_id: string | null
          created_at: string
          deleted_at: string | null
          employee_code: string
          failed_login_attempts: number
          full_name: string
          id: string
          is_active: boolean
          last_login_at: string | null
          locked_until: string | null
          pin_hash: string
          role_code: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          employee_code: string
          failed_login_attempts?: number
          full_name: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          locked_until?: string | null
          pin_hash: string
          role_code: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          employee_code?: string
          failed_login_attempts?: number
          full_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          locked_until?: string | null
          pin_hash?: string
          role_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["code"]
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string
          device_type: string
          end_reason: string | null
          ended_at: string | null
          id: string
          ip_address: unknown
          last_activity_at: string
          session_token_hash: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_type: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          ip_address?: unknown
          last_activity_at?: string
          session_token_hash: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_type?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          ip_address?: unknown
          last_activity_at?: string
          session_token_hash?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      z_reports: {
        Row: {
          generated_at: string
          id: string
          pdf_storage_path: string | null
          shift_id: string
          signed_at: string | null
          signed_by: string | null
          snapshot: Json
          status: Database["public"]["Enums"]["z_report_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          generated_at?: string
          id?: string
          pdf_storage_path?: string | null
          shift_id: string
          signed_at?: string | null
          signed_by?: string | null
          snapshot: Json
          status?: Database["public"]["Enums"]["z_report_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          generated_at?: string
          id?: string
          pdf_storage_path?: string | null
          shift_id?: string
          signed_at?: string | null
          signed_by?: string | null
          snapshot?: Json
          status?: Database["public"]["Enums"]["z_report_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "z_reports_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "z_reports_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "z_reports_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      audit_log: {
        Row: {
          action: string | null
          actor_profile_id: string | null
          id: number | null
          occurred_at: string | null
          payload: Json | null
          subject_id: string | null
          subject_table: string | null
        }
        Insert: {
          action?: string | null
          actor_profile_id?: string | null
          id?: number | null
          occurred_at?: string | null
          payload?: Json | null
          subject_id?: string | null
          subject_table?: string | null
        }
        Update: {
          action?: string | null
          actor_profile_id?: string | null
          id?: number | null
          occurred_at?: string | null
          payload?: Json | null
          subject_id?: string | null
          subject_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mv_pl_monthly: {
        Row: {
          cogs: number | null
          gross_profit: number | null
          month: string | null
          revenue: number | null
        }
        Relationships: []
      }
      mv_sales_daily: {
        Row: {
          avg_basket: number | null
          business_date: string | null
          total_orders: number | null
          total_sales: number | null
        }
        Relationships: []
      }
      mv_stock_variance: {
        Row: {
          adjusted: number | null
          current_qty: number | null
          expected: number | null
          opened: number | null
          product_id: string | null
          product_name: string | null
          sku: string | null
          sold: number | null
          variance: number | null
        }
        Relationships: []
      }
      pg_all_foreign_keys: {
        Row: {
          fk_columns: unknown[] | null
          fk_constraint_name: unknown
          fk_schema_name: unknown
          fk_table_name: unknown
          fk_table_oid: unknown
          is_deferrable: boolean | null
          is_deferred: boolean | null
          match_type: string | null
          on_delete: string | null
          on_update: string | null
          pk_columns: unknown[] | null
          pk_constraint_name: unknown
          pk_index_name: unknown
          pk_schema_name: unknown
          pk_table_name: unknown
          pk_table_oid: unknown
        }
        Relationships: []
      }
      tap_funky: {
        Row: {
          args: string | null
          is_definer: boolean | null
          is_strict: boolean | null
          is_visible: boolean | null
          kind: unknown
          langoid: unknown
          name: unknown
          oid: unknown
          owner: unknown
          returns: string | null
          returns_set: boolean | null
          schema: unknown
          volatility: string | null
        }
        Relationships: []
      }
      v_product_available_stock: {
        Row: {
          available_quantity: number | null
          current_stock: number | null
          held_quantity: number | null
          name: string | null
          product_id: string | null
          sku: string | null
        }
        Relationships: []
      }
      view_ar_aging: {
        Row: {
          b2b_company_name: string | null
          bucket: string | null
          customer_id: string | null
          customer_name: string | null
          invoice_count: number | null
          max_age_days: number | null
          min_age_days: number | null
          total_outstanding: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      view_b2b_invoices: {
        Row: {
          age_days: number | null
          b2b_company_name: string | null
          customer_id: string | null
          customer_name: string | null
          invoice_date: string | null
          invoice_id: string | null
          invoice_total: number | null
          is_unpaid: boolean | null
          order_number: string | null
          order_status: Database["public"]["Enums"]["order_status"] | null
          paid_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      view_product_allergens_resolved: {
        Row: {
          allergens: Database["public"]["Enums"]["allergen_type"][] | null
          product_id: string | null
        }
        Relationships: []
      }
      view_product_recipes: {
        Row: {
          created_at: string | null
          is_active: boolean | null
          material_cost_price: number | null
          material_current_stock: number | null
          material_id: string | null
          material_name: string | null
          material_sku: string | null
          material_unit: string | null
          notes: string | null
          product_id: string | null
          product_name: string | null
          product_sku: string | null
          product_unit: string | null
          quantity: number | null
          recipe_id: string | null
          unit: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipes_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
        ]
      }
      view_recipe_products: {
        Row: {
          cost_price: number | null
          current_stock: number | null
          has_recipe: boolean | null
          leaf_ingredient_count: number | null
          name: string | null
          product_id: string | null
          sku: string | null
          unit: string | null
        }
        Relationships: []
      }
      view_section_stock_details: {
        Row: {
          cost_price: number | null
          last_updated_at: string | null
          min_stock_threshold: number | null
          product_id: string | null
          product_name: string | null
          product_sku: string | null
          quantity: number | null
          section_code: string | null
          section_id: string | null
          section_kind: string | null
          section_name: string | null
          stock_value: number | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "section_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "section_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_available_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "section_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "view_recipe_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "section_stock_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _build_zreport_snapshot: { Args: { p_shift_id: string }; Returns: Json }
      _calculate_recipe_cost_walk: {
        Args: {
          p_current_depth: number
          p_max_depth: number
          p_path: string[]
          p_product_id: string
        }
        Returns: Json
      }
      _cleanup: { Args: never; Returns: boolean }
      _contract_on: { Args: { "": string }; Returns: unknown }
      _currtest: { Args: never; Returns: number }
      _db_privs: { Args: never; Returns: unknown[] }
      _emit_expense_je: { Args: { p_expense_id: string }; Returns: string }
      _extensions: { Args: never; Returns: unknown[] }
      _get: { Args: { "": string }; Returns: number }
      _get_latest: { Args: { "": string }; Returns: number[] }
      _get_note: { Args: { "": string }; Returns: string }
      _is_verbose: { Args: never; Returns: boolean }
      _notif_substitute: {
        Args: { p_source: string; p_vars: Json }
        Returns: string
      }
      _prokind: { Args: { p_oid: unknown }; Returns: unknown }
      _query: { Args: { "": string }; Returns: string }
      _recalc_order_totals: { Args: { p_order_id: string }; Returns: undefined }
      _record_po_payment_internal: {
        Args: {
          p_actor: string
          p_amount: number
          p_idempotency_key: string
          p_method: string
          p_po_id: string
          p_reference: string
        }
        Returns: Json
      }
      _refine_vol: { Args: { "": string }; Returns: string }
      _resolve_fifo_lot: {
        Args: { p_product_id: string; p_quantity_needed: number }
        Returns: string
      }
      _resolve_modifier_ingredients_v1: {
        Args: { p_line_qty: number; p_modifiers: Json; p_product_id: string }
        Returns: Json
      }
      _retval: { Args: { "": string }; Returns: string }
      _revoke_user_sessions_v1: {
        Args: { p_profile_id: string }
        Returns: number
      }
      _snapshot_recipe_version: {
        Args: { p_change_note: string; p_product_id: string; p_profile: string }
        Returns: string
      }
      _table_privs: { Args: never; Returns: unknown[] }
      _temptypes: { Args: { "": string }; Returns: string }
      _todo: { Args: never; Returns: string }
      _try_convert_quantity: {
        Args: { p_from: string; p_qty: number; p_to: string }
        Returns: number
      }
      _verify_pin_with_lockout: {
        Args: { p_pin: string; p_user_id: string }
        Returns: boolean
      }
      add_display_stock_v1: {
        Args: {
          p_idempotency_key?: string
          p_product_id: string
          p_quantity: number
          p_reason?: string
        }
        Returns: Json
      }
      add_opname_item_v1: {
        Args: {
          p_count_id: string
          p_expected_qty?: number
          p_notes?: string
          p_product_id: string
        }
        Returns: Json
      }
      add_order_item_v1: {
        Args: {
          p_idempotency_key: string
          p_modifiers: Json
          p_order_id: string
          p_product_id: string
          p_qty: number
        }
        Returns: Json
      }
      adjust_b2b_balance_v1: {
        Args: {
          p_customer_id: string
          p_delta: number
          p_idempotency_key?: string
          p_reason: string
        }
        Returns: Json
      }
      adjust_display_stock_v1: {
        Args: {
          p_idempotency_key?: string
          p_new_qty: number
          p_product_id: string
          p_reason: string
        }
        Returns: Json
      }
      adjust_loyalty_points: {
        Args: { p_customer_id: string; p_delta: number; p_reason: string }
        Returns: {
          new_balance: number
          new_lifetime: number
          txn_id: string
        }[]
      }
      adjust_stock_v1: {
        Args: {
          p_idempotency_key?: string
          p_new_qty: number
          p_product_id: string
          p_reason: string
        }
        Returns: Json
      }
      approve_expense_v3: {
        Args: { p_expense_id: string; p_manager_pin: string }
        Returns: Json
      }
      calculate_pb1_payable_v1: {
        Args: { p_period_end: string; p_period_start: string }
        Returns: Json
      }
      calculate_recipe_cost_v1: {
        Args: { p_max_depth?: number; p_product_id: string }
        Returns: Json
      }
      cancel_internal_transfer_v1: {
        Args: { p_reason: string; p_transfer_id: string }
        Returns: Json
      }
      cancel_opname_v1: {
        Args: { p_count_id: string; p_reason: string }
        Returns: Json
      }
      cancel_order_item_rpc_v2: {
        Args: {
          p_acting_auth_user_id: string
          p_authorized_by: string
          p_order_item_id: string
          p_reason: string
        }
        Returns: Json
      }
      cancel_print_job_v1: {
        Args: { p_id: string }
        Returns: {
          created_at: string
          device_id: string | null
          error_message: string | null
          id: string
          payload: Json
          printed_at: string | null
          priority: number
          queued_at: string
          reference_id: string | null
          reference_type: string | null
          retries: number
          source: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "print_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_purchase_order_v1: {
        Args: { p_po_id: string; p_reason: string }
        Returns: Json
      }
      cancel_tablet_order: {
        Args: { p_order_id: string }
        Returns: {
          created_at: string
          created_via: string
          customer_id: string | null
          discount_amount: number
          discount_authorized_by: string | null
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          id: string
          idempotency_key: string | null
          is_held: boolean
          loyalty_points_earned: number
          loyalty_points_redeemed: number
          loyalty_redemption_amount: number
          notes: string | null
          order_number: string
          order_type: Database["public"]["Enums"]["order_type"]
          paid_at: string | null
          promotion_total: number
          sent_to_kitchen_at: string | null
          served_by: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          table_number: string | null
          tax_amount: number
          total: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          waiter_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cash_flow_v1: { Args: { p_from: string; p_to: string }; Returns: Json }
      check_fiscal_period_open: { Args: { p_date: string }; Returns: undefined }
      claim_print_job_v1: {
        Args: { p_device_id: string }
        Returns: {
          created_at: string
          device_id: string | null
          error_message: string | null
          id: string
          payload: Json
          printed_at: string | null
          priority: number
          queued_at: string
          reference_id: string | null
          reference_type: string | null
          retries: number
          source: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "print_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_fiscal_period_v1: {
        Args: { p_lock?: boolean; p_manager_pin: string; p_period_id: string }
        Returns: Json
      }
      close_shift_v2: {
        Args: {
          p_counted_cash: number
          p_idempotency_key?: string
          p_notes?: string
          p_session_id: string
        }
        Returns: Json
      }
      col_is_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      col_not_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      complete_order_with_payment_v14: {
        Args: {
          p_customer_id?: string
          p_discount_amount?: number
          p_discount_authorized_by?: string
          p_discount_reason?: string
          p_discount_type?: string
          p_discount_value?: number
          p_idempotency_key?: string
          p_items: Json
          p_loyalty_points_redeemed?: number
          p_manager_pin?: string
          p_order_type: Database["public"]["Enums"]["order_type"]
          p_payment?: Json
          p_payments?: Json
          p_promotions?: Json
          p_session_id: string
          p_table_number?: string
        }
        Returns: Json
      }
      convert_baker_recipe_to_absolute_v1: {
        Args: { p_product_id: string; p_target_flour_qty: number }
        Returns: Json
      }
      convert_parent_to_standalone_v1: {
        Args: { p_parent_id: string }
        Returns: string
      }
      convert_product_to_parent_v1: {
        Args: {
          p_first_variant_label: string
          p_first_variant_name?: string
          p_product_id: string
          p_variant_axis: Database["public"]["Enums"]["variant_axis_type"]
        }
        Returns: string
      }
      convert_quantity: {
        Args: { p_from_unit: string; p_qty: number; p_to_unit: string }
        Returns: number
      }
      create_b2b_order_v1: {
        Args: {
          p_customer_id: string
          p_delivery_date?: string
          p_idempotency_key?: string
          p_items: Json
          p_notes?: string
        }
        Returns: Json
      }
      create_category_v1: { Args: { p_payload: Json }; Returns: Json }
      create_customer_v2: {
        Args: {
          p_customer_type?: Database["public"]["Enums"]["customer_type"]
          p_email?: string
          p_name: string
          p_phone?: string
        }
        Returns: {
          category: Json
          category_id: string
          created_at: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          deleted_at: string
          email: string
          id: string
          last_visit_at: string
          lifetime_points: number
          loyalty_points: number
          name: string
          phone: string
          total_spent: number
          total_visits: number
          updated_at: string
        }[]
      }
      create_expense_v1: {
        Args: {
          p_amount: number
          p_category_id: string
          p_description: string
          p_expense_date: string
          p_idempotency_key?: string
          p_payment_method: string
          p_receipt_url?: string
          p_vat_amount?: number
          p_vendor_name?: string
        }
        Returns: string
      }
      create_internal_transfer_v1: {
        Args: {
          p_from_section_id: string
          p_idempotency_key?: string
          p_items: Json
          p_notes?: string
          p_send_directly?: boolean
          p_to_section_id: string
        }
        Returns: Json
      }
      create_manual_je_v1: {
        Args: {
          p_description: string
          p_entry_date: string
          p_lines: Json
          p_manager_pin: string
        }
        Returns: Json
      }
      create_opname_v1: {
        Args: {
          p_idempotency_key?: string
          p_notes?: string
          p_section_id: string
        }
        Returns: Json
      }
      create_product_v1: { Args: { p_payload: Json }; Returns: Json }
      create_purchase_order_v2: {
        Args: {
          p_expected_date?: string
          p_idempotency_key?: string
          p_items: Json
          p_notes?: string
          p_order_date?: string
          p_payment_terms?: string
          p_supplier_id: string
          p_vat_rate?: number
        }
        Returns: Json
      }
      create_stock_lot_v1: {
        Args: {
          p_batch_number?: string
          p_expires_at?: string
          p_idempotency_key?: string
          p_location_id?: string
          p_metadata?: Json
          p_product_id: string
          p_quantity: number
          p_unit?: string
        }
        Returns: Json
      }
      create_tablet_order_v2: {
        Args: {
          p_client_uuid: string
          p_items: Json
          p_order_type: Database["public"]["Enums"]["order_type"]
          p_table_number: string
          p_waiter_id: string
        }
        Returns: string
      }
      create_user_v1: {
        Args: {
          p_employee_code: string
          p_full_name: string
          p_pin: string
          p_role_code: string
        }
        Returns: string
      }
      create_variant_v1: {
        Args: {
          p_cost_price?: number
          p_name?: string
          p_parent_id: string
          p_retail_price: number
          p_sku: string
          p_sort_order?: number
          p_unit?: string
          p_variant_label: string
        }
        Returns: string
      }
      current_pb1_rate: { Args: never; Returns: number }
      deactivate_recipe_v1: { Args: { p_recipe_id: string }; Returns: string }
      delete_category_v1: {
        Args: { p_category_id: string; p_idempotency_key?: string }
        Returns: Json
      }
      delete_combo_v1: { Args: { p_combo_product_id: string }; Returns: Json }
      delete_expense_threshold_v1: {
        Args: { p_threshold_id: string }
        Returns: boolean
      }
      delete_product_v1: {
        Args: { p_idempotency_key?: string; p_product_id: string }
        Returns: Json
      }
      delete_user_v1: {
        Args: { p_reason: string; p_user_id: string }
        Returns: Json
      }
      delete_variant_v1: { Args: { p_variant_id: string }; Returns: string }
      diag:
        | {
            Args: { msg: unknown }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { msg: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      diag_test_name: { Args: { "": string }; Returns: string }
      discard_held_order_v1: {
        Args: { p_order_id: string; p_reason: string }
        Returns: undefined
      }
      do_tap:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      duplicate_recipe_v1: {
        Args: {
          p_idempotency_key?: string
          p_source_product_id: string
          p_target_product_id: string
        }
        Returns: Json
      }
      enqueue_notification_v1: {
        Args: {
          p_channel?: string
          p_idempotency_key?: string
          p_recipient: string
          p_scheduled_for?: string
          p_template_code: string
          p_variables?: Json
        }
        Returns: string
      }
      enqueue_print_job_v1: {
        Args: {
          p_device_id: string
          p_payload: Json
          p_priority?: number
          p_reference_id?: string
          p_reference_type?: string
          p_source?: string
        }
        Returns: {
          created_at: string
          device_id: string | null
          error_message: string | null
          id: string
          payload: Json
          printed_at: string | null
          priority: number
          queued_at: string
          reference_id: string | null
          reference_type: string | null
          retries: number
          source: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "print_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      evaluate_promotions_v1: {
        Args: {
          p_cart_items: Json
          p_customer_id?: string
          p_subtotal?: number
        }
        Returns: Json
      }
      export_catalog_v1: { Args: never; Returns: Json }
      fail:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      finalize_opname_v1: {
        Args: { p_count_id: string; p_idempotency_key?: string }
        Returns: Json
      }
      findfuncs: { Args: { "": string }; Returns: string[] }
      finish: { Args: { exception_on_failure?: boolean }; Returns: string[] }
      fire_counter_order_v4: {
        Args: {
          p_client_uuid: string
          p_discount_authorized_by?: string
          p_items: Json
          p_order_id?: string
          p_order_type?: Database["public"]["Enums"]["order_type"]
          p_session_id: string
          p_table_number?: string
        }
        Returns: Json
      }
      format_type_string: { Args: { "": string }; Returns: string }
      get_audit_logs_v1: {
        Args: {
          p_action?: string
          p_actor_id?: string
          p_cursor?: string
          p_entity_type?: string
          p_limit?: number
        }
        Returns: {
          action: string
          actor_id: string
          created_at: string
          entity_id: string
          entity_type: string
          id: number
          metadata: Json
        }[]
      }
      get_audit_logs_v2: {
        Args: {
          p_action?: string
          p_actor_id?: string
          p_cursor?: string
          p_entity_id?: string
          p_entity_type?: string
          p_limit?: number
        }
        Returns: {
          action: string
          actor_id: string
          created_at: string
          entity_id: string
          entity_type: string
          id: number
          metadata: Json
        }[]
      }
      get_b2b_settings_v1: { Args: never; Returns: Json }
      get_balance_sheet_data: { Args: { p_as_of?: string }; Returns: Json }
      get_balance_sheet_v1: { Args: { p_as_of_date: string }; Returns: Json }
      get_basket_analysis_v1: {
        Args: { p_date_end: string; p_date_start: string; p_top_n?: number }
        Returns: {
          co_occurrence_count: number
          confidence: number
          lift: number
          product_a_name: string
          product_b_name: string
          product_id_a: string
          product_id_b: string
          support_a: number
          support_b: number
          support_pair: number
        }[]
      }
      get_cash_flow_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_cash_wallet_analysis_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_cash_wallet_balances_v1: {
        Args: never
        Returns: {
          account_code: string
          account_name: string
          balance: number
        }[]
      }
      get_cash_wallet_ledger_v2: {
        Args: {
          p_account_code: string
          p_date_end: string
          p_date_start: string
        }
        Returns: {
          category: string
          description: string
          in_amount: number
          out_amount: number
          ref_type: string
          remark: string
          row_date: string
          saldo: number
          supplier: string
        }[]
      }
      get_current_profile_id: { Args: never; Returns: string }
      get_current_role: { Args: never; Returns: string }
      get_customer_cohort_v1: {
        Args: { p_cohort_month: string; p_lookback_months?: number }
        Returns: {
          cohort_month: string
          months_since_signup: number
          retained_customers: number
          retention_pct: number
          total_revenue: number
        }[]
      }
      get_customer_product_price: {
        Args: { p_customer_id?: string; p_product_id: string }
        Returns: number
      }
      get_customer_segments_v1: {
        Args: { p_segment_type?: string }
        Returns: {
          avg_orders: number
          customer_count: number
          segment: string
          total_spent: number
        }[]
      }
      get_customer_v2: {
        Args: { p_id: string }
        Returns: {
          category: Json
          category_id: string
          created_at: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          deleted_at: string
          email: string
          id: string
          last_visit_at: string
          lifetime_points: number
          loyalty_points: number
          name: string
          phone: string
          total_spent: number
          total_visits: number
          updated_at: string
        }[]
      }
      get_daily_sales_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_expiring_lots_v1: {
        Args: {
          p_hours_ahead?: number
          p_limit?: number
          p_offset?: number
          p_product_id?: string
        }
        Returns: {
          batch_number: string
          expires_at: string
          hours_remaining: number
          id: string
          location_id: string
          location_name: string
          product_id: string
          product_name: string
          product_sku: string
          quantity: number
          received_at: string
          status: string
          total_count: number
          unit: string
        }[]
      }
      get_general_ledger_v1: {
        Args: {
          p_account_id: string
          p_cursor?: Json
          p_date_end: string
          p_date_start: string
          p_limit?: number
        }
        Returns: Json
      }
      get_low_stock_v1: {
        Args: { p_section_id?: string }
        Returns: {
          current_qty: number
          min_stock_threshold: number
          product_id: string
          product_name: string
          product_sku: string
          section_code: string
          section_id: string
          section_name: string
          shortfall: number
          unit: string
        }[]
      }
      get_loyalty_multiplier: {
        Args: { p_lifetime_points: number }
        Returns: number
      }
      get_loyalty_tier: { Args: { p_lifetime_points: number }; Returns: string }
      get_movement_aggregates_v1: {
        Args: {
          p_date_end?: string
          p_date_start?: string
          p_product_id?: string
          p_section_id?: string
        }
        Returns: Json
      }
      get_orders_list_v2: {
        Args: {
          p_cursor?: string
          p_end: string
          p_filters?: Json
          p_limit?: number
          p_start: string
        }
        Returns: Json
      }
      get_payments_by_method_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_pb1_report_v1: {
        Args: { p_period_month: number; p_period_year: number }
        Returns: Json
      }
      get_perishable_turnover_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_permission_changes_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_pos_b2b_debts_v2: {
        Args: { p_customer_id?: string; p_lookback_days?: number }
        Returns: {
          b2b_credit_limit: number
          b2b_current_balance: number
          created_at: string
          customer_id: string
          customer_name: string
          customer_phone: string
          order_id: string
          order_number: string
          order_type: string
          outstanding: number
          paid: number
          total: number
        }[]
      }
      get_price_changes_v1: {
        Args: {
          p_date_end: string
          p_date_start: string
          p_product_id?: string
        }
        Returns: Json
      }
      get_product_analytics_v1: {
        Args: { p_days?: number; p_product_id: string }
        Returns: Json
      }
      get_product_dashboard_v1: {
        Args: { p_days?: number; p_product_id: string }
        Returns: Json
      }
      get_production_efficiency_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_production_report_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_production_suggestions_v1: {
        Args: {
          p_lookback_days?: number
          p_priority_high?: number
          p_priority_medium?: number
        }
        Returns: {
          avg_daily_sales: number
          current_stock: number
          days_of_stock: number
          priority: string
          product_id: string
          product_name: string
          product_sku: string
          suggested_quantity: number
        }[]
      }
      get_profit_loss_v1: {
        Args: {
          p_date_end: string
          p_date_start: string
          p_section_id?: string
        }
        Returns: Json
      }
      get_promo_roi_v1: {
        Args: {
          p_date_end: string
          p_date_start: string
          p_promotion_id: string
        }
        Returns: Json
      }
      get_purchase_by_date_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_purchase_by_supplier_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_purchase_items_v1: {
        Args: {
          p_date_end: string
          p_date_start: string
          p_supplier_id?: string
        }
        Returns: Json
      }
      get_reorder_suggestions_v1: {
        Args: { p_buffer_days?: number; p_lookback_days?: number }
        Returns: {
          avg_daily_usage: number
          current_stock: number
          days_of_stock: number
          last_purchase_at: string
          min_stock_threshold: number
          product_id: string
          product_name: string
          product_sku: string
          suggested_order_qty: number
          supplier_id: string
          supplier_name: string
          unit: string
        }[]
      }
      get_sales_by_category_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: {
          category_id: string
          category_name: string
          qty: number
          total: number
        }[]
      }
      get_sales_by_hour_v1: {
        Args: { p_date: string }
        Returns: {
          hour: number
          order_count: number
          total: number
        }[]
      }
      get_sales_by_staff_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: {
          avg_basket: number
          order_count: number
          staff_id: string
          staff_name: string
          total: number
        }[]
      }
      get_settings_by_category_v1: {
        Args: { p_category: string }
        Returns: Json
      }
      get_staff_performance_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_stock_levels_v1: {
        Args: {
          p_category_id?: string
          p_limit?: number
          p_low_stock_only?: boolean
          p_offset?: number
          p_search?: string
        }
        Returns: {
          category_id: string
          category_name: string
          current_stock: number
          last_movement_at: string
          min_stock_threshold: number
          name: string
          product_id: string
          sku: string
          total_count: number
        }[]
      }
      get_stock_movement_ledger_v1: {
        Args: {
          p_end: string
          p_limit?: number
          p_movement_type?: string
          p_product_id?: string
          p_section_id?: string
          p_start: string
        }
        Returns: Json
      }
      get_stock_movements_v1: {
        Args: {
          p_cursor?: string
          p_cursor_id?: string
          p_date_end?: string
          p_date_start?: string
          p_limit?: number
          p_movement_type?: string
          p_product_id?: string
          p_section_id?: string
        }
        Returns: {
          author_name: string
          created_at: string
          created_by: string
          from_section_code: string
          from_section_id: string
          id: string
          lot_id: string
          metadata: Json
          movement_type: Database["public"]["Enums"]["movement_type"]
          product_id: string
          product_name: string
          product_sku: string
          quantity: number
          reason: string
          reference_id: string
          reference_type: string
          supplier_id: string
          supplier_name: string
          to_section_code: string
          to_section_id: string
          unit: string
          unit_cost: number
        }[]
      }
      get_stock_movements_v2: {
        Args: {
          p_cursor?: string
          p_end: string
          p_limit?: number
          p_movement_type?: string
          p_product_id?: string
          p_start: string
        }
        Returns: Json
      }
      get_stock_variance_v1: {
        Args: {
          p_date_end?: string
          p_date_start?: string
          p_section_id?: string
        }
        Returns: {
          adjusted: number
          current_qty: number
          expected: number
          opened: number
          product_id: string
          product_name: string
          sku: string
          sold: number
          variance: number
          variance_pct: number
        }[]
      }
      get_trial_balance_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_wastage_report_v1: {
        Args: { p_date_end: string; p_date_start: string }
        Returns: Json
      }
      get_zreport_snapshot_v1: { Args: { p_zreport_id: string }; Returns: Json }
      has_kiosk_jwt: { Args: { p_required_scope?: string }; Returns: boolean }
      has_permission: {
        Args: { p_perm: string; p_uid: string }
        Returns: boolean
      }
      has_permission_for_profile: {
        Args: { p_perm: string; p_profile_id: string }
        Returns: boolean
      }
      has_unique: { Args: { "": string }; Returns: string }
      hash_pin: { Args: { p_pin: string }; Returns: string }
      hold_order_v1: {
        Args: {
          p_cart_payload: Json
          p_client_uuid: string
          p_notes?: string
          p_table_number?: string
        }
        Returns: string
      }
      import_catalog_v1: {
        Args: {
          p_dry_run?: boolean
          p_idempotency_key?: string
          p_payload: Json
        }
        Returns: Json
      }
      import_customers_v1: {
        Args: {
          p_dry_run?: boolean
          p_idempotency_key?: string
          p_payload: Json
        }
        Returns: Json
      }
      import_suppliers_v1: {
        Args: {
          p_dry_run?: boolean
          p_idempotency_key?: string
          p_payload: Json
        }
        Returns: Json
      }
      in_todo: { Args: never; Returns: boolean }
      is_authenticated: { Args: never; Returns: boolean }
      is_empty: { Args: { "": string }; Returns: string }
      isnt_empty: { Args: { "": string }; Returns: string }
      kds_bump_item_v1: {
        Args: { p_idempotency_key?: string; p_order_item_id: string }
        Returns: {
          bumped_at: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          combo_components: Json | null
          created_at: string
          discount_amount: number
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          dispatch_station: string | null
          id: string
          is_cancelled: boolean
          is_locked: boolean
          is_promo_gift: boolean
          kitchen_status: string
          line_total: number
          modifier_ingredients_deducted: Json | null
          modifiers: Json
          modifiers_total: number
          name_snapshot: string
          order_id: string
          prep_started_at: string | null
          product_id: string
          promotion_id: string | null
          quantity: number
          ready_at: string | null
          sent_to_kitchen_at: string | null
          served_at: string | null
          served_by: string | null
          unit_price: number
        }
        SetofOptions: {
          from: "*"
          to: "order_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      kds_recall_order_v1: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: number
      }
      kds_start_prep_timer_v1: {
        Args: { p_order_item_id: string }
        Returns: {
          bumped_at: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          combo_components: Json | null
          created_at: string
          discount_amount: number
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          dispatch_station: string | null
          id: string
          is_cancelled: boolean
          is_locked: boolean
          is_promo_gift: boolean
          kitchen_status: string
          line_total: number
          modifier_ingredients_deducted: Json | null
          modifiers: Json
          modifiers_total: number
          name_snapshot: string
          order_id: string
          prep_started_at: string | null
          product_id: string
          promotion_id: string | null
          quantity: number
          ready_at: string | null
          sent_to_kitchen_at: string | null
          served_at: string | null
          served_by: string | null
          unit_price: number
        }
        SetofOptions: {
          from: "*"
          to: "order_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      kds_undo_bump_v1: {
        Args: { p_order_item_id: string }
        Returns: {
          bumped_at: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          combo_components: Json | null
          created_at: string
          discount_amount: number
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          dispatch_station: string | null
          id: string
          is_cancelled: boolean
          is_locked: boolean
          is_promo_gift: boolean
          kitchen_status: string
          line_total: number
          modifier_ingredients_deducted: Json | null
          modifiers: Json
          modifiers_total: number
          name_snapshot: string
          order_id: string
          prep_started_at: string | null
          product_id: string
          promotion_id: string | null
          quantity: number
          ready_at: string | null
          sent_to_kitchen_at: string | null
          served_at: string | null
          served_by: string | null
          unit_price: number
        }
        SetofOptions: {
          from: "*"
          to: "order_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      list_recipes_v1: { Args: { p_product_id: string }; Returns: Json[] }
      lives_ok: { Args: { "": string }; Returns: string }
      mark_expired_lots_hourly: { Args: never; Returns: Json }
      mark_item_served: {
        Args: { p_item_id: string }
        Returns: {
          bumped_at: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          combo_components: Json | null
          created_at: string
          discount_amount: number
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          dispatch_station: string | null
          id: string
          is_cancelled: boolean
          is_locked: boolean
          is_promo_gift: boolean
          kitchen_status: string
          line_total: number
          modifier_ingredients_deducted: Json | null
          modifiers: Json
          modifiers_total: number
          name_snapshot: string
          order_id: string
          prep_started_at: string | null
          product_id: string
          promotion_id: string | null
          quantity: number
          ready_at: string | null
          sent_to_kitchen_at: string | null
          served_at: string | null
          served_by: string | null
          unit_price: number
        }
        SetofOptions: {
          from: "*"
          to: "order_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_print_done_v1: {
        Args: { p_id: string }
        Returns: {
          created_at: string
          device_id: string | null
          error_message: string | null
          id: string
          payload: Json
          printed_at: string | null
          priority: number
          queued_at: string
          reference_id: string | null
          reference_type: string | null
          retries: number
          source: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "print_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_print_failed_v1: {
        Args: { p_error: string; p_id: string }
        Returns: {
          created_at: string
          device_id: string | null
          error_message: string | null
          id: string
          payload: Json
          printed_at: string | null
          priority: number
          queued_at: string
          reference_id: string | null
          reference_type: string | null
          retries: number
          source: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "print_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      next_count_number: { Args: never; Returns: string }
      next_expense_number: { Args: { p_date?: string }; Returns: string }
      next_journal_entry_number: { Args: { p_date: string }; Returns: string }
      next_transfer_number: { Args: never; Returns: string }
      no_plan: { Args: never; Returns: boolean[] }
      notify_birthday_customers_v1: { Args: never; Returns: number }
      num_failed: { Args: never; Returns: number }
      os_name: { Args: never; Returns: string }
      pass:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      pay_existing_order_v10: {
        Args: {
          p_customer_id?: string
          p_discount_amount?: number
          p_discount_authorized_by?: string
          p_discount_reason?: string
          p_discount_type?: string
          p_discount_value?: number
          p_idempotency_key?: string
          p_loyalty_points_redeemed?: number
          p_order_id: string
          p_payment?: Json
          p_payments?: Json
          p_promotions?: Json
        }
        Returns: Json
      }
      pay_expense_v1: {
        Args: { p_expense_id: string; p_payment_method?: string }
        Returns: Json
      }
      pg_version: { Args: never; Returns: string }
      pg_version_num: { Args: never; Returns: number }
      pgtap_version: { Args: never; Returns: number }
      pick_notifications_batch_v1: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          channel: string
          id: string
          recipient: string
          retries: number
          scheduled_for: string
          status: string
          subject: string
          template_code: string
        }[]
      }
      pickup_tablet_order: {
        Args: { p_order_id: string; p_session_id: string }
        Returns: {
          created_at: string
          created_via: string
          customer_id: string | null
          discount_amount: number
          discount_authorized_by: string | null
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          id: string
          idempotency_key: string | null
          is_held: boolean
          loyalty_points_earned: number
          loyalty_points_redeemed: number
          loyalty_redemption_amount: number
          notes: string | null
          order_number: string
          order_type: Database["public"]["Enums"]["order_type"]
          paid_at: string | null
          promotion_total: number
          sent_to_kitchen_at: string | null
          served_by: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          table_number: string | null
          tax_amount: number
          total: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          waiter_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      receive_internal_transfer_v1: {
        Args: {
          p_idempotency_key?: string
          p_received_items: Json
          p_transfer_id: string
        }
        Returns: Json
      }
      receive_purchase_order_v2: {
        Args: {
          p_idempotency_key?: string
          p_po_id: string
          p_received_items: Json
          p_section_id: string
        }
        Returns: Json
      }
      receive_stock_v1: {
        Args: {
          p_idempotency_key?: string
          p_product_id: string
          p_quantity: number
          p_reason?: string
          p_supplier_id: string
          p_unit_cost?: number
        }
        Returns: Json
      }
      recipe_bom_full_v1: {
        Args: { p_max_depth?: number; p_product_id: string }
        Returns: {
          cost_price: number
          current_stock: number
          line_cost: number
          material_id: string
          material_name: string
          material_unit: string
          qty_in_base: number
          qty_per_unit: number
          recipe_unit: string
        }[]
      }
      recipe_cost_history_v1: {
        Args: { p_from: string; p_product_id?: string; p_to: string }
        Returns: {
          baseline_cost: number
          change_count: number
          change_note: string
          cost_per_unit: number
          created_at: string
          delta_pct: number
          product_id: string
          product_name: string
          version_number: number
        }[]
      }
      recipe_direct_cost_v1: {
        Args: { p_product_id: string }
        Returns: {
          cost_price: number
          current_stock: number
          line_cost: number
          material_id: string
          material_name: string
          material_unit: string
          qty_in_base: number
          qty_per_unit: number
          recipe_unit: string
        }[]
      }
      recompute_all_recipe_costs_v1: {
        Args: { p_max_plausible?: number }
        Returns: Json
      }
      recompute_recipe_cost_v1: {
        Args: { p_max_plausible?: number; p_product_id: string }
        Returns: Json
      }
      recompute_recipe_margins_v1: { Args: never; Returns: Json }
      record_b2b_payment_v1: {
        Args: {
          p_amount: number
          p_customer_id: string
          p_idempotency_key?: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_notes?: string
          p_paid_at?: string
          p_reference?: string
        }
        Returns: Json
      }
      record_batch_production_v1: {
        Args: { p_batch: Json; p_items: Json }
        Returns: Json
      }
      record_batch_production_v2: {
        Args: { p_batch: Json; p_items: Json }
        Returns: Json
      }
      record_cash_movement_v2: {
        Args: {
          p_amount: number
          p_direction: string
          p_idempotency_key?: string
          p_reason: string
          p_reason_code?: string
          p_session_id: string
        }
        Returns: Json
      }
      record_cash_wallet_movement_v1: {
        Args: {
          p_amount: number
          p_idempotency_key: string
          p_movement_date: string
          p_movement_type: string
          p_remark: string
          p_wallet_code?: string
        }
        Returns: string
      }
      record_incoming_stock_v1: {
        Args: {
          p_idempotency_key?: string
          p_product_id: string
          p_quantity: number
          p_reason?: string
          p_supplier_id?: string
          p_unit_cost?: number
        }
        Returns: Json
      }
      record_pin_failure_v1: {
        Args: { p_source?: string; p_user_id: string }
        Returns: Json
      }
      record_po_payment_v1: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_method: string
          p_po_id: string
          p_reference?: string
        }
        Returns: Json
      }
      record_production_v1: {
        Args: {
          p_actual_yield_qty?: number
          p_batch_number?: string
          p_expected_yield_qty?: number
          p_idempotency_key?: string
          p_notes?: string
          p_product_id: string
          p_quantity_produced: number
          p_quantity_waste?: number
          p_recurse_subrecipes?: boolean
          p_section_id: string
          p_yield_variance_reason?: string
        }
        Returns: Json
      }
      record_rate_limit_v1: {
        Args: {
          p_bucket_key: string
          p_function_name: string
          p_ip_address: string
          p_max_per_window: number
          p_window_sec?: number
        }
        Returns: {
          allowed: boolean
          current_count: number
          retry_after_sec: number
        }[]
      }
      record_stock_movement_v1: {
        Args: {
          p_from_section_id?: string
          p_idempotency_key?: string
          p_lot_id?: string
          p_metadata?: Json
          p_movement_type: Database["public"]["Enums"]["movement_type"]
          p_product_id: string
          p_quantity: number
          p_reason: string
          p_supplier_id?: string
          p_to_section_id?: string
          p_unit?: string
          p_unit_cost?: number
        }
        Returns: Json
      }
      refresh_mv_pl_monthly: { Args: never; Returns: undefined }
      refresh_mv_sales_daily: { Args: never; Returns: undefined }
      refresh_mv_stock_variance: { Args: never; Returns: undefined }
      refund_order_rpc_v4: {
        Args: {
          p_acting_auth_user_id: string
          p_authorized_by: string
          p_idempotency_key: string
          p_lines: Json
          p_order_id: string
          p_reason: string
          p_tenders: Json
        }
        Returns: Json
      }
      reject_expense_v1: {
        Args: { p_expense_id: string; p_reason: string }
        Returns: undefined
      }
      release_expired_reservations: { Args: never; Returns: number }
      remove_order_item_v1: {
        Args: { p_idempotency_key: string; p_order_item_id: string }
        Returns: Json
      }
      reorder_categories_v1: {
        Args: { p_ordered_ids: string[] }
        Returns: Json
      }
      reorder_recipe_rows_v1: {
        Args: { p_product_id: string; p_recipe_ids: string[] }
        Returns: number
      }
      reorder_variants_v1: {
        Args: { p_ordered_variant_ids: string[]; p_parent_id: string }
        Returns: number
      }
      reservation_consume_v1: {
        Args: { p_reservation_id: string }
        Returns: Json
      }
      reservation_hold_v1: {
        Args: {
          p_expires_at: string
          p_holder_id?: string
          p_holder_type: string
          p_idempotency_key?: string
          p_notes?: string
          p_product_id: string
          p_quantity: number
          p_section_id?: string
        }
        Returns: Json
      }
      reservation_release_v1: {
        Args: { p_reason?: string; p_reservation_id: string }
        Returns: Json
      }
      reset_user_pin_v1: {
        Args: { p_new_pin: string; p_user_id: string }
        Returns: undefined
      }
      resolve_mapping_account: {
        Args: { p_mapping_key: string }
        Returns: string
      }
      restore_held_order_v1: { Args: { p_order_id: string }; Returns: Json }
      retry_sale_journal_entry_v1: {
        Args: { p_order_id: string }
        Returns: Json
      }
      return_display_to_kitchen_v1: {
        Args: {
          p_idempotency_key?: string
          p_product_id: string
          p_quantity: number
          p_reason?: string
        }
        Returns: Json
      }
      revert_production_v1: {
        Args: { p_production_id: string; p_reason: string }
        Returns: Json
      }
      round_idr: { Args: { amount: number }; Returns: number }
      runtests:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      search_customers_v2: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          category: Json
          category_id: string
          created_at: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          deleted_at: string
          email: string
          id: string
          last_visit_at: string
          lifetime_points: number
          loyalty_points: number
          name: string
          phone: string
          total_spent: number
          total_visits: number
          updated_at: string
        }[]
      }
      search_ingredients_v1: {
        Args: { p_kind?: string; p_limit?: number; p_query?: string }
        Returns: {
          cost_price: number
          current_stock: number
          has_recipe: boolean
          kind: string
          name: string
          product_id: string
          sku: string
          unit: string
        }[]
      }
      send_items_to_kitchen: {
        Args: { p_item_ids: string[] }
        Returns: {
          bumped_at: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          combo_components: Json | null
          created_at: string
          discount_amount: number
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          dispatch_station: string | null
          id: string
          is_cancelled: boolean
          is_locked: boolean
          is_promo_gift: boolean
          kitchen_status: string
          line_total: number
          modifier_ingredients_deducted: Json | null
          modifiers: Json
          modifiers_total: number
          name_snapshot: string
          order_id: string
          prep_started_at: string | null
          product_id: string
          promotion_id: string | null
          quantity: number
          ready_at: string | null
          sent_to_kitchen_at: string | null
          served_at: string | null
          served_by: string | null
          unit_price: number
        }[]
        SetofOptions: {
          from: "*"
          to: "order_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_expense_threshold_v1: {
        Args: {
          p_amount_max?: number
          p_amount_min?: number
          p_category_id?: string
          p_steps?: Json
          p_threshold_id?: string
        }
        Returns: string
      }
      set_opname_count_v1: {
        Args: {
          p_count_item_id: string
          p_counted_qty: number
          p_notes?: string
        }
        Returns: Json
      }
      set_product_base_unit_v1: {
        Args: { p_new_unit: string; p_product_id: string }
        Returns: Json
      }
      set_product_sections_v1: {
        Args: {
          p_primary_section_id: string
          p_product_id: string
          p_section_ids: string[]
        }
        Returns: Json
      }
      set_product_units_v1: {
        Args: { p_alts: Json; p_contexts: Json; p_product_id: string }
        Returns: Json
      }
      set_setting_v1: {
        Args: { p_category: string; p_key: string; p_value: Json }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sign_zreport_v2: {
        Args: { p_manager_pin: string; p_zreport_id: string }
        Returns: Json
      }
      skip:
        | { Args: { "": string }; Returns: string }
        | { Args: { how_many: number; why: string }; Returns: string }
      soft_delete_customer: {
        Args: { p_customer_id: string; p_reason?: string }
        Returns: undefined
      }
      storage_path_to_expense_id: { Args: { p_name: string }; Returns: string }
      submit_expense_v2: {
        Args: { p_expense_id: string; p_idempotency_key?: string }
        Returns: Json
      }
      suggest_production_schedule_v1: {
        Args: { p_target_date: string }
        Returns: Json
      }
      throws_ok: { Args: { "": string }; Returns: string }
      todo:
        | { Args: { how_many: number }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
        | { Args: { why: string }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
      todo_end: { Args: never; Returns: boolean[] }
      todo_start:
        | { Args: never; Returns: boolean[] }
        | { Args: { "": string }; Returns: boolean[] }
      update_account_active_v1: {
        Args: { p_account_id: string; p_is_active: boolean }
        Returns: Json
      }
      update_accounting_mapping_v1: {
        Args: {
          p_account_code: string
          p_is_active: boolean
          p_mapping_key: string
          p_reason: string
        }
        Returns: undefined
      }
      update_b2b_settings_v1: { Args: { p_patch: Json }; Returns: Json }
      update_category_v1: {
        Args: { p_category_id: string; p_patch: Json }
        Returns: Json
      }
      update_cost_price_v1: {
        Args: {
          p_idempotency_key?: string
          p_new_cost: number
          p_product_id: string
          p_reason: string
        }
        Returns: Json
      }
      update_lan_heartbeat_v1: {
        Args: { p_device_code: string }
        Returns: {
          capabilities: Json
          code: string
          created_at: string
          deleted_at: string | null
          device_type: string
          id: string
          ip_address: unknown
          is_active: boolean
          last_heartbeat_at: string | null
          location: string | null
          name: string
          port: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lan_devices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_order_item_qty_v1: {
        Args: {
          p_idempotency_key: string
          p_order_item_id: string
          p_qty: number
        }
        Returns: Json
      }
      update_product_v1: {
        Args: { p_patch: Json; p_product_id: string }
        Returns: Json
      }
      update_purchase_order_v1: {
        Args: { p_patch: Json; p_po_id: string }
        Returns: Json
      }
      update_role_session_timeout_v1: {
        Args: { p_minutes: number; p_role_code: string }
        Returns: boolean
      }
      update_user_profile_v1: {
        Args: {
          p_employee_code: string
          p_full_name: string
          p_user_id: string
        }
        Returns: undefined
      }
      update_user_role_v1: {
        Args: { p_new_role_code: string; p_reason: string; p_user_id: string }
        Returns: Json
      }
      update_variant_v1: {
        Args: { p_patch: Json; p_variant_id: string }
        Returns: string
      }
      upsert_combo_v1: {
        Args: { p_combo: Json; p_idempotency_key?: string }
        Returns: Json
      }
      upsert_product_modifiers_v1: {
        Args: { p_groups: Json; p_product_id: string }
        Returns: Json
      }
      upsert_recipe_v1: {
        Args: {
          p_baker_percentage?: number
          p_is_baker_percentage?: boolean
          p_material_id: string
          p_notes?: string
          p_product_id: string
          p_quantity: number
          p_unit: string
        }
        Returns: string
      }
      validate_b2b_credit_limit_v1: {
        Args: { p_customer_id: string; p_order_amount: number }
        Returns: Json
      }
      validate_opname_v1: { Args: { p_count_id: string }; Returns: Json }
      verify_user_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: boolean
      }
      void_order_rpc_v3: {
        Args: {
          p_acting_auth_user_id: string
          p_authorized_by: string
          p_order_id: string
          p_reason: string
        }
        Returns: Json
      }
      void_zreport_v1: {
        Args: { p_reason: string; p_zreport_id: string }
        Returns: Json
      }
      waste_display_stock_v1: {
        Args: {
          p_idempotency_key?: string
          p_product_id: string
          p_quantity: number
          p_reason?: string
        }
        Returns: Json
      }
      waste_stock_v1: {
        Args: {
          p_idempotency_key?: string
          p_product_id: string
          p_quantity: number
          p_reason: string
        }
        Returns: Json
      }
    }
    Enums: {
      allergen_type:
        | "gluten"
        | "crustaceans"
        | "eggs"
        | "fish"
        | "peanuts"
        | "soy"
        | "milk"
        | "nuts"
        | "celery"
        | "mustard"
        | "sesame"
        | "sulphites"
        | "lupin"
        | "molluscs"
      cash_flow_section: "operating" | "investing" | "financing" | "none"
      customer_type: "retail" | "b2b"
      discount_template_type: "percentage" | "fixed_amount"
      display_movement_type:
        | "stock_in"
        | "sale"
        | "return_to_kitchen"
        | "waste"
        | "adjustment"
      loyalty_txn_type: "earn" | "redeem" | "adjust" | "refund"
      modifier_group_type: "single_select" | "multi_select"
      movement_type:
        | "sale"
        | "sale_void"
        | "production"
        | "purchase"
        | "waste"
        | "adjustment"
        | "transfer_in"
        | "transfer_out"
        | "production_in"
        | "production_out"
        | "adjustment_in"
        | "adjustment_out"
        | "opname_in"
        | "opname_out"
        | "incoming"
        | "purchase_return"
        | "reservation_hold"
        | "reservation_release"
        | "cost_price_correction"
      order_status:
        | "draft"
        | "paid"
        | "voided"
        | "pending_payment"
        | "completed"
        | "b2b_pending"
      order_type: "dine_in" | "take_out" | "delivery" | "b2b"
      payment_method:
        | "cash"
        | "card"
        | "qris"
        | "edc"
        | "transfer"
        | "store_credit"
      price_modifier_type:
        | "retail"
        | "wholesale"
        | "discount_percentage"
        | "custom"
      promotion_scope: "cart" | "product" | "category"
      promotion_type:
        | "percentage"
        | "fixed_amount"
        | "bogo"
        | "free_product"
        | "threshold"
        | "bundle"
      shift_status: "open" | "closed"
      variant_axis_type: "flavor" | "size" | "format"
      z_report_status: "draft" | "signed" | "voided"
    }
    CompositeTypes: {
      _time_trial_type: {
        a_time: number | null
      }
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
  public: {
    Enums: {
      allergen_type: [
        "gluten",
        "crustaceans",
        "eggs",
        "fish",
        "peanuts",
        "soy",
        "milk",
        "nuts",
        "celery",
        "mustard",
        "sesame",
        "sulphites",
        "lupin",
        "molluscs",
      ],
      cash_flow_section: ["operating", "investing", "financing", "none"],
      customer_type: ["retail", "b2b"],
      discount_template_type: ["percentage", "fixed_amount"],
      display_movement_type: [
        "stock_in",
        "sale",
        "return_to_kitchen",
        "waste",
        "adjustment",
      ],
      loyalty_txn_type: ["earn", "redeem", "adjust", "refund"],
      modifier_group_type: ["single_select", "multi_select"],
      movement_type: [
        "sale",
        "sale_void",
        "production",
        "purchase",
        "waste",
        "adjustment",
        "transfer_in",
        "transfer_out",
        "production_in",
        "production_out",
        "adjustment_in",
        "adjustment_out",
        "opname_in",
        "opname_out",
        "incoming",
        "purchase_return",
        "reservation_hold",
        "reservation_release",
        "cost_price_correction",
      ],
      order_status: [
        "draft",
        "paid",
        "voided",
        "pending_payment",
        "completed",
        "b2b_pending",
      ],
      order_type: ["dine_in", "take_out", "delivery", "b2b"],
      payment_method: [
        "cash",
        "card",
        "qris",
        "edc",
        "transfer",
        "store_credit",
      ],
      price_modifier_type: [
        "retail",
        "wholesale",
        "discount_percentage",
        "custom",
      ],
      promotion_scope: ["cart", "product", "category"],
      promotion_type: [
        "percentage",
        "fixed_amount",
        "bogo",
        "free_product",
        "threshold",
        "bundle",
      ],
      shift_status: ["open", "closed"],
      variant_axis_type: ["flavor", "size", "format"],
      z_report_status: ["draft", "signed", "voided"],
    },
  },
} as const
