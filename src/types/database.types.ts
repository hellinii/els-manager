export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      asset_prices: {
        Row: {
          as_of_date: string
          asset_id: string
          created_at: string
          id: string
          price: number
          provider: string | null
          source: Database["public"]["Enums"]["price_source"]
        }
        Insert: {
          as_of_date: string
          asset_id: string
          created_at?: string
          id?: string
          price: number
          provider?: string | null
          source: Database["public"]["Enums"]["price_source"]
        }
        Update: {
          as_of_date?: string
          asset_id?: string
          created_at?: string
          id?: string
          price?: number
          provider?: string | null
          source?: Database["public"]["Enums"]["price_source"]
        }
        Relationships: [
          {
            foreignKeyName: "asset_prices_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_provider_symbols: {
        Row: {
          asset_id: string
          id: string
          provider: string
          provider_symbol: string
        }
        Insert: {
          asset_id: string
          id?: string
          provider: string
          provider_symbol: string
        }
        Update: {
          asset_id?: string
          id?: string
          provider?: string
          provider_symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_provider_symbols_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          currency: string
          id: string
          market: string | null
          name: string
        }
        Insert: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          currency: string
          id?: string
          market?: string | null
          name: string
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          currency?: string
          id?: string
          market?: string | null
          name?: string
        }
        Relationships: []
      }
      els_products: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          annual_coupon_rate: number
          created_at: string
          evaluation_period_months: number
          id: string
          issue_date: string
          issuer: string | null
          ki_barrier: number | null
          ki_observation: Database["public"]["Enums"]["ki_observation"] | null
          ki_touched_at: string | null
          name: string
          note: string | null
          owner_id: string
          principal: number
          updated_at: string
        }
        Insert: {
          account_type: Database["public"]["Enums"]["account_type"]
          annual_coupon_rate: number
          created_at?: string
          evaluation_period_months?: number
          id?: string
          issue_date: string
          issuer?: string | null
          ki_barrier?: number | null
          ki_observation?: Database["public"]["Enums"]["ki_observation"] | null
          ki_touched_at?: string | null
          name: string
          note?: string | null
          owner_id: string
          principal: number
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          annual_coupon_rate?: number
          created_at?: string
          evaluation_period_months?: number
          id?: string
          issue_date?: string
          issuer?: string | null
          ki_barrier?: number | null
          ki_observation?: Database["public"]["Enums"]["ki_observation"] | null
          ki_touched_at?: string | null
          name?: string
          note?: string | null
          owner_id?: string
          principal?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "els_products_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      els_underlyings: {
        Row: {
          asset_id: string
          base_price: number
          els_id: string
          id: string
          sequence: number
        }
        Insert: {
          asset_id: string
          base_price: number
          els_id: string
          id?: string
          sequence: number
        }
        Update: {
          asset_id?: string
          base_price?: number
          els_id?: string
          id?: string
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "els_underlyings_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "els_underlyings_els_id_fkey"
            columns: ["els_id"]
            isOneToOne: false
            referencedRelation: "els_products"
            referencedColumns: ["id"]
          },
        ]
      }
      redemption_schedules: {
        Row: {
          barrier: number
          els_id: string
          evaluation_date: string
          id: string
          lizard_barrier: number | null
          lizard_coupon_rate: number | null
          lizard_requires_no_ki: boolean | null
          round_no: number
        }
        Insert: {
          barrier: number
          els_id: string
          evaluation_date: string
          id?: string
          lizard_barrier?: number | null
          lizard_coupon_rate?: number | null
          lizard_requires_no_ki?: boolean | null
          round_no: number
        }
        Update: {
          barrier?: number
          els_id?: string
          evaluation_date?: string
          id?: string
          lizard_barrier?: number | null
          lizard_coupon_rate?: number | null
          lizard_requires_no_ki?: boolean | null
          round_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "redemption_schedules_els_id_fkey"
            columns: ["els_id"]
            isOneToOne: false
            referencedRelation: "els_products"
            referencedColumns: ["id"]
          },
        ]
      }
      redemptions: {
        Row: {
          els_id: string
          gross_amount: number
          id: string
          is_confirmed: boolean
          note: string | null
          redemption_date: string
          redemption_type: Database["public"]["Enums"]["redemption_type"]
          round_no: number | null
          taxable_income: number
          withholding_tax: number | null
        }
        Insert: {
          els_id: string
          gross_amount: number
          id?: string
          is_confirmed: boolean
          note?: string | null
          redemption_date: string
          redemption_type: Database["public"]["Enums"]["redemption_type"]
          round_no?: number | null
          taxable_income: number
          withholding_tax?: number | null
        }
        Update: {
          els_id?: string
          gross_amount?: number
          id?: string
          is_confirmed?: boolean
          note?: string | null
          redemption_date?: string
          redemption_type?: Database["public"]["Enums"]["redemption_type"]
          round_no?: number | null
          taxable_income?: number
          withholding_tax?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "redemptions_els_id_fkey"
            columns: ["els_id"]
            isOneToOne: true
            referencedRelation: "els_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "redemptions_els_id_round_no_fkey"
            columns: ["els_id", "round_no"]
            isOneToOne: false
            referencedRelation: "redemption_schedules"
            referencedColumns: ["els_id", "round_no"]
          },
        ]
      }
      tax_brackets: {
        Row: {
          lower_bound: number
          progressive_deduction: number
          rate: number
          tax_year: number
        }
        Insert: {
          lower_bound: number
          progressive_deduction: number
          rate: number
          tax_year: number
        }
        Update: {
          lower_bound?: number
          progressive_deduction?: number
          rate?: number
          tax_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_brackets_tax_year_fkey"
            columns: ["tax_year"]
            isOneToOne: false
            referencedRelation: "tax_years"
            referencedColumns: ["tax_year"]
          },
        ]
      }
      tax_constants: {
        Row: {
          key: string
          tax_year: number
          value: number
        }
        Insert: {
          key: string
          tax_year: number
          value: number
        }
        Update: {
          key?: string
          tax_year?: number
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_constants_tax_year_fkey"
            columns: ["tax_year"]
            isOneToOne: false
            referencedRelation: "tax_years"
            referencedColumns: ["tax_year"]
          },
        ]
      }
      tax_profiles: {
        Row: {
          health_insurance_type: Database["public"]["Enums"]["health_insurance_type"]
          id: string
          other_financial_income: number
          other_income_base: number
          tax_year: number
          user_id: string
        }
        Insert: {
          health_insurance_type: Database["public"]["Enums"]["health_insurance_type"]
          id?: string
          other_financial_income?: number
          other_income_base?: number
          tax_year: number
          user_id: string
        }
        Update: {
          health_insurance_type?: Database["public"]["Enums"]["health_insurance_type"]
          id?: string
          other_financial_income?: number
          other_income_base?: number
          tax_year?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_years: {
        Row: {
          note: string | null
          tax_year: number
        }
        Insert: {
          note?: string | null
          tax_year: number
        }
        Update: {
          note?: string | null
          tax_year?: number
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          display_name: string
          email: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      account_type: "GENERAL" | "TAX_FREE"
      asset_type: "STOCK" | "INDEX" | "ETF"
      health_insurance_type: "EMPLOYEE" | "REGIONAL" | "DEPENDENT" | "NONE"
      ki_observation: "CONTINUOUS" | "CLOSING"
      price_source: "AUTO" | "MANUAL"
      redemption_type: "EARLY" | "LIZARD" | "MATURITY_GAIN" | "MATURITY_LOSS"
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
  public: {
    Enums: {
      account_type: ["GENERAL", "TAX_FREE"],
      asset_type: ["STOCK", "INDEX", "ETF"],
      health_insurance_type: ["EMPLOYEE", "REGIONAL", "DEPENDENT", "NONE"],
      ki_observation: ["CONTINUOUS", "CLOSING"],
      price_source: ["AUTO", "MANUAL"],
      redemption_type: ["EARLY", "LIZARD", "MATURITY_GAIN", "MATURITY_LOSS"],
    },
  },
} as const

