/** Floor plan visuel (ADR-006 déc. 9, lot A) — grille fixe par section. */
export const FLOOR_GRID_COLS = 12;
export const FLOOR_GRID_ROWS = 8;

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
  /** Lot A floor plan visuel — cellule sur la grille 12×8 de la section ; NULL = non placée. */
  grid_x: number | null;
  grid_y: number | null;
  /** Shape of the joined nested select; optional so list queries without the join still type. */
  table_sections?: { name: string; sort_order: number } | null;
}
