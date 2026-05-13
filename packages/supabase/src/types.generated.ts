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
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: number
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: number
          metadata?: Json | null
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
      business_config: {
        Row: {
          created_at: string
          currency: string
          fiscal_address: string | null
          id: number
          name: string
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
          tax_inclusive?: boolean
          tax_rate?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          deleted_at: string | null
          dispatch_station: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          dispatch_station?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          dispatch_station?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      combo_items: {
        Row: {
          component_product_id: string
          created_at: string
          parent_product_id: string
          quantity: number
          sort_order: number
        }
        Insert: {
          component_product_id: string
          created_at?: string
          parent_product_id: string
          quantity?: number
          sort_order?: number
        }
        Update: {
          component_product_id?: string
          created_at?: string
          parent_product_id?: string
          quantity?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "combo_items_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "combo_items_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_items_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "mv_stock_variance"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "combo_items_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
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
          category_id: string | null
          created_at: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          deleted_at: string | null
          email: string | null
          id: string
          last_visit_at: string | null
          lifetime_points: number
          loyalty_points: number
          name: string
          phone: string | null
          total_spent: number
          total_visits: number
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          deleted_at?: string | null
          email?: string | null
          id?: string
          last_visit_at?: string | null
          lifetime_points?: number
          loyalty_points?: number
          name: string
          phone?: string | null
          total_spent?: number
          total_visits?: number
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          deleted_at?: string | null
          email?: string | null
          id?: string
          last_visit_at?: string | null
          lifetime_points?: number
          loyalty_points?: number
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
        ]
      }
      order_items: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
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
          modifiers: Json
          modifiers_total: number
          name_snapshot: string
          order_id: string
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
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
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
          modifiers?: Json
          modifiers_total?: number
          name_snapshot: string
          order_id: string
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
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
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
          modifiers?: Json
          modifiers_total?: number
          name_snapshot?: string
          order_id?: string
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
          loyalty_points_earned: number
          loyalty_points_redeemed: number
          loyalty_redemption_amount: number
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
          loyalty_points_earned?: number
          loyalty_points_redeemed?: number
          loyalty_redemption_amount?: number
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
          loyalty_points_earned?: number
          loyalty_points_redeemed?: number
          loyalty_redemption_amount?: number
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
          closed_at: string | null
          closed_by: string | null
          closing_cash: number | null
          expected_cash: number | null
          id: string
          opened_at: string
          opened_by: string
          opening_cash: number
          opening_notes: string | null
          status: Database["public"]["Enums"]["shift_status"]
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_cash?: number | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opened_by: string
          opening_cash: number
          opening_notes?: string | null
          status?: Database["public"]["Enums"]["shift_status"]
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_cash?: number | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opened_by?: string
          opening_cash?: number
          opening_notes?: string | null
          status?: Database["public"]["Enums"]["shift_status"]
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
        ]
      }
      production_records: {
        Row: {
          batch_number: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          je_posted: boolean
          materials_consumed: boolean
          notes: string | null
          product_id: string
          production_date: string
          production_number: string
          quantity_produced: number
          quantity_waste: number
          reverted_at: string | null
          reverted_by: string | null
          reverted_reason: string | null
          section_id: string | null
          staff_id: string | null
          stock_updated: boolean
          updated_at: string
        }
        Insert: {
          batch_number?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          je_posted?: boolean
          materials_consumed?: boolean
          notes?: string | null
          product_id: string
          production_date?: string
          production_number: string
          quantity_produced: number
          quantity_waste?: number
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          section_id?: string | null
          staff_id?: string | null
          stock_updated?: boolean
          updated_at?: string
        }
        Update: {
          batch_number?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          je_posted?: boolean
          materials_consumed?: boolean
          notes?: string | null
          product_id?: string
          production_date?: string
          production_number?: string
          quantity_produced?: number
          quantity_waste?: number
          reverted_at?: string | null
          reverted_by?: string | null
          reverted_reason?: string | null
          section_id?: string | null
          staff_id?: string | null
          stock_updated?: boolean
          updated_at?: string
        }
        Relationships: [
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
      products: {
        Row: {
          category_id: string
          cost_price: number
          created_at: string
          current_stock: number
          default_shelf_life_hours: number | null
          deleted_at: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_favorite: boolean
          min_stock_threshold: number
          name: string
          product_type: string
          retail_price: number
          sku: string
          tax_inclusive: boolean
          unit: string
          updated_at: string
          wholesale_price: number | null
        }
        Insert: {
          category_id: string
          cost_price?: number
          created_at?: string
          current_stock?: number
          default_shelf_life_hours?: number | null
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_favorite?: boolean
          min_stock_threshold?: number
          name: string
          product_type?: string
          retail_price: number
          sku: string
          tax_inclusive?: boolean
          unit?: string
          updated_at?: string
          wholesale_price?: number | null
        }
        Update: {
          category_id?: string
          cost_price?: number
          created_at?: string
          current_stock?: number
          default_shelf_life_hours?: number | null
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_favorite?: boolean
          min_stock_threshold?: number
          name?: string
          product_type?: string
          retail_price?: number
          sku?: string
          tax_inclusive?: boolean
          unit?: string
          updated_at?: string
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
        ]
      }
      recipes: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          material_id: string
          notes: string | null
          product_id: string
          quantity: number
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          material_id: string
          notes?: string | null
          product_id: string
          quantity: number
          unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
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
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          is_system?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          is_system?: boolean
          name?: string
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
      _cleanup: { Args: never; Returns: boolean }
      _contract_on: { Args: { "": string }; Returns: unknown }
      _currtest: { Args: never; Returns: number }
      _db_privs: { Args: never; Returns: unknown[] }
      _extensions: { Args: never; Returns: unknown[] }
      _get: { Args: { "": string }; Returns: number }
      _get_latest: { Args: { "": string }; Returns: number[] }
      _get_note: { Args: { "": string }; Returns: string }
      _is_verbose: { Args: never; Returns: boolean }
      _prokind: { Args: { p_oid: unknown }; Returns: unknown }
      _query: { Args: { "": string }; Returns: string }
      _refine_vol: { Args: { "": string }; Returns: string }
      _resolve_fifo_lot: {
        Args: { p_product_id: string; p_quantity_needed: number }
        Returns: string
      }
      _retval: { Args: { "": string }; Returns: string }
      _table_privs: { Args: never; Returns: unknown[] }
      _temptypes: { Args: { "": string }; Returns: string }
      _todo: { Args: never; Returns: string }
      add_opname_item_v1: {
        Args: {
          p_count_id: string
          p_expected_qty?: number
          p_notes?: string
          p_product_id: string
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
      calculate_vat_payable: {
        Args: { p_period_end: string; p_period_start: string }
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
      cancel_order_item_rpc: {
        Args: {
          p_authorized_by: string
          p_order_item_id: string
          p_reason: string
        }
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
          loyalty_points_earned: number
          loyalty_points_redeemed: number
          loyalty_redemption_amount: number
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
      check_fiscal_period_open: { Args: { p_date: string }; Returns: undefined }
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
      complete_order_with_payment_v9: {
        Args: {
          p_customer_id?: string
          p_discount_amount?: number
          p_discount_authorized_by?: string
          p_discount_reason?: string
          p_discount_type?: string
          p_discount_value?: number
          p_idempotency_key?: string
          p_items: Json
          p_loyalty_multiplier?: number
          p_loyalty_points_redeemed?: number
          p_order_type: Database["public"]["Enums"]["order_type"]
          p_payment?: Json
          p_payments?: Json
          p_promotions?: Json
          p_session_id: string
          p_table_number?: string
        }
        Returns: Json
      }
      convert_quantity: {
        Args: { p_from_unit: string; p_qty: number; p_to_unit: string }
        Returns: number
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
      create_opname_v1: {
        Args: {
          p_idempotency_key?: string
          p_notes?: string
          p_section_id: string
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
      create_tablet_order: {
        Args: {
          p_items: Json
          p_order_type: Database["public"]["Enums"]["order_type"]
          p_table_number: string
          p_waiter_id: string
        }
        Returns: string
      }
      deactivate_recipe_v1: { Args: { p_recipe_id: string }; Returns: string }
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
      do_tap:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      evaluate_promotions_v1: {
        Args: {
          p_cart_items: Json
          p_customer_id?: string
          p_subtotal?: number
        }
        Returns: Json
      }
      fail:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      finalize_opname_v1: {
        Args: { p_count_id: string; p_idempotency_key?: string }
        Returns: Json
      }
      findfuncs: { Args: { "": string }; Returns: string[] }
      finish: { Args: { exception_on_failure?: boolean }; Returns: string[] }
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
      get_balance_sheet_data: { Args: { p_as_of?: string }; Returns: Json }
      get_current_profile_id: { Args: never; Returns: string }
      get_current_role: { Args: never; Returns: string }
      get_customer_product_price: {
        Args: { p_customer_id?: string; p_product_id: string }
        Returns: number
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
      get_product_dashboard_v1: {
        Args: { p_days?: number; p_product_id: string }
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
      in_todo: { Args: never; Returns: boolean }
      is_authenticated: { Args: never; Returns: boolean }
      is_empty: { Args: { "": string }; Returns: string }
      isnt_empty: { Args: { "": string }; Returns: string }
      list_recipes_v1: { Args: { p_product_id: string }; Returns: Json[] }
      lives_ok: { Args: { "": string }; Returns: string }
      mark_expired_lots_hourly: { Args: never; Returns: Json }
      mark_item_served: {
        Args: { p_item_id: string }
        Returns: {
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
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
          modifiers: Json
          modifiers_total: number
          name_snapshot: string
          order_id: string
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
      next_count_number: { Args: never; Returns: string }
      next_journal_entry_number: { Args: { p_date: string }; Returns: string }
      next_transfer_number: { Args: never; Returns: string }
      no_plan: { Args: never; Returns: boolean[] }
      num_failed: { Args: never; Returns: number }
      os_name: { Args: never; Returns: string }
      pass:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      pay_existing_order_v6: {
        Args: {
          p_customer_id?: string
          p_discount_amount?: number
          p_discount_authorized_by?: string
          p_discount_reason?: string
          p_discount_type?: string
          p_discount_value?: number
          p_idempotency_key?: string
          p_loyalty_multiplier?: number
          p_loyalty_points_redeemed?: number
          p_order_id: string
          p_payment?: Json
          p_payments?: Json
          p_promotions?: Json
        }
        Returns: string
      }
      pg_version: { Args: never; Returns: string }
      pg_version_num: { Args: never; Returns: number }
      pgtap_version: { Args: never; Returns: number }
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
          loyalty_points_earned: number
          loyalty_points_redeemed: number
          loyalty_redemption_amount: number
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
      record_production_v1: {
        Args: {
          p_batch_number?: string
          p_idempotency_key?: string
          p_notes?: string
          p_product_id: string
          p_quantity_produced: number
          p_quantity_waste?: number
          p_section_id: string
        }
        Returns: Json
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
      refund_order_rpc_v2: {
        Args: {
          p_authorized_by: string
          p_idempotency_key?: string
          p_lines: Json
          p_order_id: string
          p_reason: string
          p_tenders: Json
        }
        Returns: Json
      }
      resolve_mapping_account: {
        Args: { p_mapping_key: string }
        Returns: string
      }
      round_idr: { Args: { amount: number }; Returns: number }
      runtests:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      send_items_to_kitchen: {
        Args: { p_item_ids: string[] }
        Returns: {
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
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
          modifiers: Json
          modifiers_total: number
          name_snapshot: string
          order_id: string
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
      set_opname_count_v1: {
        Args: {
          p_count_item_id: string
          p_counted_qty: number
          p_notes?: string
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      skip:
        | { Args: { "": string }; Returns: string }
        | { Args: { how_many: number; why: string }; Returns: string }
      soft_delete_customer: {
        Args: { p_customer_id: string; p_reason?: string }
        Returns: undefined
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
      upsert_recipe_v1: {
        Args: {
          p_material_id: string
          p_notes?: string
          p_product_id: string
          p_quantity: number
          p_unit: string
        }
        Returns: string
      }
      validate_opname_v1: { Args: { p_count_id: string }; Returns: Json }
      verify_user_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: boolean
      }
      void_order_rpc: {
        Args: { p_authorized_by: string; p_order_id: string; p_reason: string }
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
      customer_type: "retail" | "b2b"
      discount_template_type: "percentage" | "fixed_amount"
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
      order_status:
        | "draft"
        | "paid"
        | "voided"
        | "pending_payment"
        | "completed"
      order_type: "dine_in" | "take_out" | "delivery"
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
      customer_type: ["retail", "b2b"],
      discount_template_type: ["percentage", "fixed_amount"],
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
      ],
      order_status: ["draft", "paid", "voided", "pending_payment", "completed"],
      order_type: ["dine_in", "take_out", "delivery"],
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
    },
  },
} as const
