import { Select } from '@breakery/ui';

// Canonical labelled select — mirrors Input surface/height exactly so form
// rows read as one family (styled native <select>, no Radix Select in kit).
export const Default = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <label className="text-xs uppercase tracking-widest text-text-muted block mb-2">
      Category
    </label>
    <Select defaultValue="viennoiserie">
      <option value="viennoiserie">Viennoiserie</option>
      <option value="bread">Bread & Sourdough</option>
      <option value="patisserie">Pâtisserie</option>
      <option value="coffee">Coffee & Drinks</option>
      <option value="sandwich">Sandwiches</option>
    </Select>
  </div>
);

// Placeholder-style state — empty value option selected.
export const WithPlaceholder = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <label className="text-xs uppercase tracking-widest text-text-muted block mb-2">
      Payment method
    </label>
    <Select defaultValue="">
      <option value="" disabled>
        Select a method…
      </option>
      <option value="cash">Cash</option>
      <option value="qris">QRIS</option>
      <option value="edc">EDC Card</option>
    </Select>
  </div>
);

export const DisabledState = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <label className="text-xs uppercase tracking-widest text-text-muted block mb-2">
      Outlet (fixed for this terminal)
    </label>
    <Select disabled defaultValue="senggigi">
      <option value="senggigi">The Breakery — Senggigi</option>
    </Select>
  </div>
);
