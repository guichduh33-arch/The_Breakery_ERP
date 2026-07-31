import { Input } from '@breakery/ui';

export const Default = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <label className="text-xs uppercase tracking-widest text-text-muted block mb-2">
      Customer name
    </label>
    <Input placeholder="e.g. Ibu Sari" />
  </div>
);

export const WithValue = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <label className="text-xs uppercase tracking-widest text-text-muted block mb-2">
      Phone
    </label>
    <Input type="tel" defaultValue="+62 812 345 678" />
  </div>
);

export const Disabled = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <label className="text-xs uppercase tracking-widest text-text-muted block mb-2">
      Table (auto-assigned)
    </label>
    <Input disabled placeholder="Locked during service" />
  </div>
);

export const SearchField = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <Input type="search" placeholder="Search products or SKU…" />
  </div>
);
