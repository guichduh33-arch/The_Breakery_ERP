// apps/backoffice/src/pages/customers/customer-detail/InfoTab.tsx
//
// "Info" tab of the customer detail page: contact card + optional B2B account
// card. Co-located split (S57 E-D4) — behaviour unchanged.

import { useState, type JSX } from 'react';
import { Mail, Phone } from 'lucide-react';
import { Card } from '@breakery/ui';
import type { CustomerDetailRow } from '@/features/customers/hooks/useCustomerDetail.js';
import { useUpdateRetailCreditLimit } from '@/features/customers/hooks/useUpdateRetailCreditLimit.js';
import { RetailCreditLimitSection } from '@/features/customers/components/RetailCreditLimitSection.js';
import { useAuthStore } from '@/stores/authStore.js';
import { AdjustB2bBalanceModal } from '@/features/btob/components/AdjustB2bBalanceModal.js';
import { rp } from './shared.js';

export function InfoTab({ customer, canEdit }: { customer: CustomerDetailRow; canEdit: boolean }): JSX.Element {
  const updateCreditLimit = useUpdateRetailCreditLimit(customer.id);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAdjustBalance = customer.customer_type === 'b2b' && hasPermission('b2b.balance.adjust');
  const [adjustOpen, setAdjustOpen] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card variant="default" padding="md" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-text-secondary">Contact</h2>
        {customer.email && (
          <div className="flex items-center gap-2 text-sm text-text-primary">
            <Mail className="h-4 w-4 text-text-muted" aria-hidden /> {customer.email}
          </div>
        )}
        {customer.phone && (
          <div className="flex items-center gap-2 text-sm text-text-primary">
            <Phone className="h-4 w-4 text-text-muted" aria-hidden /> {customer.phone}
          </div>
        )}
        {!customer.email && !customer.phone && (
          <p className="text-sm text-text-muted">No contact on file.</p>
        )}
        <div className="pt-2 text-xs text-text-muted">
          Customer since {new Date(customer.created_at).toLocaleDateString('id-ID')}
          {customer.birth_date && ` · Birthday ${new Date(customer.birth_date).toLocaleDateString('id-ID')}`}
        </div>
      </Card>

      {customer.customer_type === 'b2b' && (
        <Card variant="default" padding="md" className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-secondary">B2B account</h2>
          {customer.b2b_company_name && (
            <div className="text-sm text-text-primary">Company: <strong>{customer.b2b_company_name}</strong></div>
          )}
          {customer.b2b_tax_id && (
            <div className="text-sm text-text-primary">Tax ID (NPWP): {customer.b2b_tax_id}</div>
          )}
          <div className="text-sm text-text-primary">Credit limit: <strong>{rp(customer.b2b_credit_limit)}</strong></div>
          <div className="flex items-center justify-between text-sm text-text-primary">
            <span>Current balance: <strong>{rp(customer.b2b_current_balance)}</strong></span>
            {canAdjustBalance && (
              <button
                type="button"
                onClick={() => setAdjustOpen(true)}
                className="text-xs uppercase tracking-wide text-gold hover:underline"
              >
                Adjust…
              </button>
            )}
          </div>
          {customer.b2b_payment_terms_days != null && (
            <div className="text-xs text-text-muted">Payment terms: {customer.b2b_payment_terms_days} days net</div>
          )}
        </Card>
      )}

      {customer.customer_type === 'b2b' && (
        <AdjustB2bBalanceModal
          customerId={customer.id}
          customerName={customer.b2b_company_name ?? customer.name}
          open={adjustOpen}
          onClose={() => setAdjustOpen(false)}
        />
      )}

      {customer.customer_type === 'retail' && (
        <RetailCreditLimitSection
          value={customer.retail_credit_limit}
          canEdit={canEdit}
          saving={updateCreditLimit.isPending}
          onSave={(next) => updateCreditLimit.mutate(next)}
        />
      )}
    </div>
  );
}
