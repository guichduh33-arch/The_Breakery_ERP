export interface TableSection {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface RestaurantTable {
  id: string;
  name: string;
  seats: number;
  sort_order: number;
  is_active: boolean;
  /** S75 — real section FK (NULL = legacy/unsectioned, rendered under "Interior"). */
  section_id: string | null;
  /** Shape of the joined nested select; optional so list queries without the join still type. */
  table_sections?: { name: string; sort_order: number } | null;
}
