import { TableSelectorModal } from '@breakery/ui';

// Choix de table pour une commande sur place — grille de cartes tactiles avec
// badges Free / Occupied et le bouton « No table / Skip » en pied.
const table = (id: string, name: string, seats: number, sort_order: number) => ({
  id,
  name,
  seats,
  sort_order,
  is_active: true,
  section_id: null,
  grid_x: null,
  grid_y: null,
});

const tables = [
  table('t1', 'T1', 2, 1),
  table('t2', 'T2', 2, 2),
  table('t3', 'T3', 4, 3),
  table('t4', 'T4', 4, 4),
  table('t5', 'T5', 4, 5),
  table('t6', 'T6', 6, 6),
  table('t7', 'T7', 6, 7),
  table('t8', 'T8', 8, 8),
];

const occupancy = { T2: true, T5: true, T7: true };

export const Open = () => (
  <div className="fixed inset-0 bg-bg-base">
    <TableSelectorModal
      open
      onClose={() => {}}
      onSelect={() => {}}
      tables={tables}
      occupancy={occupancy}
    />
  </div>
);
