-- Source de rapports limitée aux journées fermées.
CREATE VIEW reporting_private.recognized_sales_v2 AS
 SELECT id,
    order_number,
    session_id,
    served_by,
    order_type,
    status,
    subtotal,
    tax_amount,
    total,
    idempotency_key,
    created_at,
    updated_at,
    paid_at,
    customer_id,
    loyalty_points_earned,
    loyalty_points_redeemed,
    loyalty_redemption_amount,
    table_number,
    created_via,
    waiter_id,
    sent_to_kitchen_at,
    discount_amount,
    discount_type,
    discount_value,
    discount_reason,
    discount_authorized_by,
    promotion_total,
    voided_at,
    voided_by,
    void_reason,
    is_held,
    notes,
    is_historical_import,
    import_reference,
    invoice_number,
    pickup_date,
    b2b_delivered_at,
    recipe_consumption_revision,
    financial_import_document_id,
    outstanding_at,
        CASE
            WHEN outstanding_at IS NOT NULL THEN outstanding_at
            ELSE COALESCE(paid_at, created_at)
        END AS recognized_at
   FROM reporting_private.closed_pos_orders_v1 o
  WHERE status <> 'voided'::order_status AND voided_at IS NULL AND (outstanding_at IS NOT NULL OR (status = ANY (ARRAY['paid'::order_status, 'completed'::order_status])));
REVOKE ALL ON reporting_private.recognized_sales_v2 FROM PUBLIC,anon,authenticated;
