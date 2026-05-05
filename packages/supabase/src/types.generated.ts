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
      customers: {
        Row: {
          id:              string
          name:            string
          phone:           string | null
          email:           string | null
          customer_type:   Database["public"]["Enums"]["customer_type"]
          loyalty_points:  number
          lifetime_points: number
          total_spent:     number
          total_visits:    number
          last_visit_at:   string | null
          created_at:      string
          updated_at:      string
          deleted_at:      string | null
        }
        Insert: {
          id?:              string
          name:             string
          phone?:           string | null
          email?:           string | null
          customer_type?:   Database["public"]["Enums"]["customer_type"]
          loyalty_points?:  number
          lifetime_points?: number
          total_spent?:     number
          total_visits?:    number
          last_visit_at?:   string | null
          created_at?:      string
          updated_at?:      string
          deleted_at?:      string | null
        }
        Update: {
          id?:              string
          name?:            string
          phone?:           string | null
          email?:           string | null
          customer_type?:   Database["public"]["Enums"]["customer_type"]
          loyalty_points?:  number
          lifetime_points?: number
          total_spent?:     number
          total_visits?:    number
          last_visit_at?:   string | null
          created_at?:      string
          updated_at?:      string
          deleted_at?:      string | null
        }
        Relationships: []
      }
      loyalty_transactions: {
        Row: {
          id:                   string
          customer_id:          string
          order_id:             string | null
          transaction_type:     Database["public"]["Enums"]["loyalty_txn_type"]
          points:               number
          points_balance_after: number
          order_amount:         number | null
          description:          string
          created_at:           string
          created_by:           string | null
        }
        Insert: {
          id?:                   string
          customer_id:           string
          order_id?:             string | null
          transaction_type:      Database["public"]["Enums"]["loyalty_txn_type"]
          points:                number
          points_balance_after:  number
          order_amount?:         number | null
          description:           string
          created_at?:           string
          created_by?:           string | null
        }
        Update: {
          id?:                   string
          customer_id?:          string
          order_id?:             string | null
          transaction_type?:     Database["public"]["Enums"]["loyalty_txn_type"]
          points?:               number
          points_balance_after?: number
          order_amount?:         number | null
          description?:          string
          created_at?:           string
          created_by?:           string | null
        }
        Relationships: [
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
            foreignKeyName: "loyalty_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
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
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          entry_date: string
          entry_number: string
          id: string
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
      order_items: {
        Row: {
          created_at: string
          id: string
          line_total: number
          name_snapshot: string
          order_id: string
          product_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total: number
          name_snapshot: string
          order_id: string
          product_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total?: number
          name_snapshot?: string
          order_id?: string
          product_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
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
            referencedRelation: "products"
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
        }
        Insert: {
          amount: number
          cash_received?: number | null
          change_given?: number | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          paid_at?: string
        }
        Update: {
          amount?: number
          cash_received?: number | null
          change_given?: number | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          order_id?: string
          paid_at?: string
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
          created_at:                  string
          customer_id:                 string | null
          id:                          string
          idempotency_key:             string | null
          loyalty_points_earned:       number
          loyalty_points_redeemed:     number
          loyalty_redemption_amount:   number
          order_number:                string
          order_type:                  Database["public"]["Enums"]["order_type"]
          paid_at:                     string | null
          served_by:                   string
          session_id:                  string
          status:                      Database["public"]["Enums"]["order_status"]
          subtotal:                    number
          tax_amount:                  number
          total:                       number
          updated_at:                  string
        }
        Insert: {
          created_at?:                  string
          customer_id?:                 string | null
          id?:                          string
          idempotency_key?:             string | null
          loyalty_points_earned?:       number
          loyalty_points_redeemed?:     number
          loyalty_redemption_amount?:   number
          order_number:                 string
          order_type?:                  Database["public"]["Enums"]["order_type"]
          paid_at?:                     string | null
          served_by:                    string
          session_id:                   string
          status?:                      Database["public"]["Enums"]["order_status"]
          subtotal:                     number
          tax_amount:                   number
          total:                        number
          updated_at?:                  string
        }
        Update: {
          created_at?:                  string
          customer_id?:                 string | null
          id?:                          string
          idempotency_key?:             string | null
          loyalty_points_earned?:       number
          loyalty_points_redeemed?:     number
          loyalty_redemption_amount?:   number
          order_number?:                string
          order_type?:                  Database["public"]["Enums"]["order_type"]
          paid_at?:                     string | null
          served_by?:                   string
          session_id?:                  string
          status?:                      Database["public"]["Enums"]["order_status"]
          subtotal?:                    number
          tax_amount?:                  number
          total?:                       number
          updated_at?:                  string
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
      products: {
        Row: {
          category_id: string
          created_at: string
          current_stock: number
          deleted_at: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_favorite: boolean
          name: string
          retail_price: number
          sku: string
          tax_inclusive: boolean
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_favorite?: boolean
          name: string
          retail_price: number
          sku: string
          tax_inclusive?: boolean
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_favorite?: boolean
          name?: string
          retail_price?: number
          sku?: string
          tax_inclusive?: boolean
          updated_at?: string
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
      stock_movements: {
        Row: {
          created_at: string
          created_by: string
          id: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          product_id: string
          quantity: number
          reference_id: string
          reference_type: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          product_id: string
          quantity: number
          reference_id: string
          reference_type: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          movement_type?: Database["public"]["Enums"]["movement_type"]
          product_id?: string
          quantity?: number
          reference_id?: string
          reference_type?: string
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
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
      [_ in never]: never
    }
    Functions: {
      complete_order_with_payment: {
        Args: {
          p_session_id:              string
          p_order_type:              Database["public"]["Enums"]["order_type"]
          p_items:                   Json
          p_payment:                 Json
          p_idempotency_key?:        string
          p_customer_id?:            string | null
          p_loyalty_points_redeemed?: number
        }
        Returns: Json
      }
      has_permission: {
        Args: { p_perm: string; p_uid: string }
        Returns: boolean
      }
      hash_pin: { Args: { p_pin: string }; Returns: string }
      is_authenticated: { Args: never; Returns: boolean }
      round_idr: { Args: { amount: number }; Returns: number }
      verify_user_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      customer_type: "retail" | "b2b"
      loyalty_txn_type: "earn" | "redeem" | "adjust"
      movement_type:
        | "sale"
        | "sale_void"
        | "production"
        | "purchase"
        | "waste"
        | "adjustment"
      order_status: "draft" | "paid" | "voided"
      order_type: "dine_in" | "take_out" | "delivery"
      payment_method:
        | "cash"
        | "card"
        | "qris"
        | "edc"
        | "transfer"
        | "store_credit"
      shift_status: "open" | "closed"
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
      movement_type: [
        "sale",
        "sale_void",
        "production",
        "purchase",
        "waste",
        "adjustment",
      ],
      order_status: ["draft", "paid", "voided"],
      order_type: ["dine_in", "take_out", "delivery"],
      payment_method: [
        "cash",
        "card",
        "qris",
        "edc",
        "transfer",
        "store_credit",
      ],
      shift_status: ["open", "closed"],
    },
  },
} as const

