import { DiscountModal } from '@breakery/ui';

const noop = () => {};
const neverAuthorize = async () => null;

// Radix portal renders to <body> — a fixed luxe-dark backdrop stands in for
// the POS screen behind the full-screen modal.
const Backdrop = () => (
  <div aria-hidden="true" className="fixed inset-0 bg-bg-base" />
);

// Just-opened state on a Rp 245,000 cart — %/IDR toggle, quick presets from
// POS Settings, mono value display, canonical Numpad, reason field, footer.
export const ApplyDiscount = () => (
  <>
    <Backdrop />
    <DiscountModal
      open
      onClose={noop}
      onConfirm={noop}
      base={245000}
      onRequireAuthorization={neverAuthorize}
      presets={[
        { value: 10, name: 'Staff' },
        { value: 15, name: 'Regular' },
        { value: 30, name: 'Day-old bake' },
      ]}
    />
  </>
);
