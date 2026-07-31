import { NumpadVirtual } from '@breakery/ui';

// Cash mode — opening-float entry: raw value above, decimal key, Confirm
// submit, secondary Cancel.
export const CashEntry = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <NumpadVirtual
      mode="cash"
      initialValue="1500000"
      onSubmit={() => {}}
      onCancel={() => {}}
    />
  </div>
);

// Numeric mode — quantity / weight entry: no decimal, backspace key, OK
// submit with check icon.
export const QuantityEntry = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <NumpadVirtual mode="numeric" initialValue="24" onSubmit={() => {}} />
  </div>
);

// PIN mode — masked dots (3 of 6 filled), Verify submit disabled until the
// 6th digit; error message state.
export const PinEntryWithError = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <NumpadVirtual
      mode="pin"
      initialValue="123"
      onSubmit={() => {}}
      onCancel={() => {}}
      error="Incorrect PIN — 2 attempts left"
    />
  </div>
);
