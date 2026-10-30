-- Deux acomptes fictifs integrement affectes ; aucune fixture persistante.
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(payload,'{stock_mode}','"financial_only"'),'{allow_customer_advances}','true');
UPDATE historical_fixture SET payload=jsonb_set(payload,'{documents}',(SELECT jsonb_agg(jsonb_build_object(
 'source_reference','ADV-DOC-'||n,'source_sha256',repeat('a',64),'source_row',n,'reconciled',true,
 'document_date','2097-01-'||(25+n),'customer_treatment','corporate','customer_id',corporate,
 'stock_mode','financial_only','net_amount',100000,'tax_amount',0,'total_amount',100000,'discount_amount',0,
 'tax_source','sales_details_ticket','lines',jsonb_build_array(jsonb_build_object('source_reference','L1',
 'product_id',product,'quantity',1,'unit','pcs','unit_price',100000,'line_total',100000,'reconciled',true))) ORDER BY n)
 FROM generate_series(1,2)n));
UPDATE historical_fixture SET payload=jsonb_set(payload,'{payments}',(SELECT jsonb_agg(jsonb_build_object(
 'source_reference','ADV-PAY-'||n,'source_sha256',repeat('a',64),'source_row',10+n,'reconciled',true,
 'payment_date','2097-01-25','amount',100000,'method','transfer','customer_advance',true,'customer_id',corporate,
 'allocations',jsonb_build_array(jsonb_build_object('document_reference','ADV-DOC-'||n,'amount',100000,
 'application_date','2097-01-'||(25+n)))) ORDER BY n) FROM generate_series(1,2)n));
