-- Validation d'enveloppe pure : aucune fixture ni écriture métier persistante.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE historical_envelope_fixture(payload jsonb);
INSERT INTO historical_envelope_fixture VALUES (jsonb_build_object(
 'contract_version',1,'kind','sales','currency','IDR','source_system','fixture',
 'batch_reference','fixture-october','period_start','2026-09-01','period_end','2026-10-31',
 'source_files',jsonb_build_array(jsonb_build_object('sha256',repeat('a',64),'file_name','fixture.xlsx','sheet_name','Sales')),
 'documents',jsonb_build_array(jsonb_build_object(
  'source_reference','SALE-1','source_sha256',repeat('a',64),'source_row',2,'reconciled',true,
  'document_date','2026-10-01','net_amount','100000.00','tax_amount','10000.00',
  'total_amount','110000.00','discount_amount','0.00','tax_source','sales_details_ticket',
  'customer_treatment','retail','lines',jsonb_build_array(
   jsonb_build_object('source_reference','LINE-1','product_id','10000000-0000-0000-0000-000000000001',
    'quantity','1','unit','pcs','line_total','85000.00','reconciled',true,'export_tax_amount','34000.00'),
   jsonb_build_object('source_reference','LINE-2','product_id','10000000-0000-0000-0000-000000000002',
    'quantity','1','unit','pcs','line_total','25000.00','reconciled',true,'export_tax_amount','10000.00')))),
 'payments',jsonb_build_array(jsonb_build_object(
  'source_reference','PAY-1','source_sha256',repeat('a',64),'source_row',3,'reconciled',true,
  'payment_date','2026-10-02','amount','110000.00','method','cash',
  'allocations',jsonb_build_array(jsonb_build_object('document_reference','SALE-1','amount','110000.00'))))));
CREATE TEMP TABLE historical_envelope_tap(id integer GENERATED ALWAYS AS IDENTITY,result text);
INSERT INTO historical_envelope_tap(result)
SELECT is(_historical_import_envelope_errors_v1(payload),'[]'::jsonb,'Ticket tax is authoritative; divergent exported line taxes are not used') FROM historical_envelope_fixture
UNION ALL SELECT is(_historical_import_envelope_errors_v1(jsonb_set(payload,'{payments}','[]')),'[]'::jsonb,'Unpaid sale has no invented payment') FROM historical_envelope_fixture
UNION ALL SELECT is(_historical_import_number_v1('"1.10"'),1.1::numeric,'Valid cents accepted')
UNION ALL SELECT is(_historical_import_number_v1('"1.005"'),NULL::numeric,'Fractional cent rejected')
UNION ALL SELECT is(_historical_import_number_v1('"NaN"'),NULL::numeric,'NaN rejected')
UNION ALL SELECT is(_historical_import_number_v1('"Infinity"'),NULL::numeric,'Infinity rejected')
UNION ALL SELECT is(_historical_import_number_v1('true'),NULL::numeric,'Boolean is not money')
UNION ALL SELECT is(_historical_import_number_v1('"-1"'),NULL::numeric,'Negative unsigned amount rejected')
UNION ALL SELECT is(_historical_import_number_v1('"1000000000000"'),NULL::numeric,'Money upper bound enforced')
UNION ALL SELECT is(_historical_import_number_v1('"1.123456"',6),1.123456::numeric,'Quantity precision accepted')
UNION ALL SELECT is(_historical_import_number_v1('"1.1234567"',6),NULL::numeric,'Quantity precision overflow rejected')
UNION ALL SELECT is(_historical_import_number_v1('"1"',NULL),NULL::numeric,'Null numeric scale rejected')
UNION ALL SELECT is(_historical_import_date_v1('"2026-02-30"'),NULL::date,'Impossible calendar date rejected')
UNION ALL SELECT is(_historical_import_date_v1('"01/10/2026"'),NULL::date,'Ambiguous date format rejected')
UNION ALL SELECT is(_historical_import_date_v1('"2026-10-16"'),date '2026-10-16','Exact ISO date preserved')
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(NULL) @> '[{"code":"object_required"}]','Null payload rejected')
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{source_files}','{}')) @> '[{"code":"source_files_required"}]','Malformed source list rejected without raising') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{documents}','"bad"')) @> '[{"code":"documents_required"}]','Malformed document list rejected without raising') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{payments}','{}')) @> '[{"code":"payments_array_required"}]','Malformed payment list rejected without raising') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{documents,0,lines}','null')) @> '[{"code":"lines_required"}]','Malformed lines rejected without raising') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{payments,0,allocations}','{}')) @> '[{"code":"allocations_required"}]','Malformed allocations rejected without raising') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{documents,0,reconciled}','false')) @> '[{"code":"document_not_reconciled"}]','Unreconciled document blocked') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{documents,0,lines,0,reconciled}','false')) @> '[{"code":"invalid_or_unreconciled_line"}]','Unreconciled line blocked') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{documents,0,tax_source}','"item_export"')) @> '[{"code":"ticket_tax_required"}]','Line export cannot replace ticket tax') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{documents,0,tax_amount}','"9999.99"')) @> '[{"code":"invalid_document_amounts"}]','Net plus tax must equal ticket total') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{documents,0,lines,0,line_total}','"85001"')) @> '[{"code":"line_total_mismatch"}]','Lines must reconcile to the ticket total') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{documents,0,customer_treatment}','"owner_company_benefit"')) @> '[{"code":"owner_accounting_pending"}]','Owner is explicitly pending') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{payments,0,amount}','"0"')) @> '[{"code":"invalid_or_unreconciled_payment"}]','Zero payment rejected') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{payments,0,method}','"store_credit"')) @> '[{"code":"unsupported_payment_method"}]','Store credit cannot fabricate an opening balance') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{payments,0,method}','"made_up"')) @> '[{"code":"unsupported_payment_method"}]','Unknown enum value rejected') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{payments,0,allocations,0,document_reference}','"OTHER"')) @> '[{"code":"invalid_allocation"}]','Payment cannot target an unknown document') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{payments,0,allocations,0,amount}','"109999"')) @> '[{"code":"allocation_total_mismatch"}]','Payment allocation must reconcile exactly') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(jsonb_set(payload,'{payments,0,amount}','"110001"'),'{payments,0,allocations,0,amount}','"110001"')) @> '[{"code":"document_overallocated"}]','Overpayment rejected') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{documents}',(payload->'documents')||(payload->'documents'))) @> '[{"code":"invalid_or_duplicate_reference"}]','Duplicate document references rejected') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{payments}',(payload->'payments')||(payload->'payments'))) @> '[{"code":"invalid_or_duplicate_payment"}]','Duplicate payment references rejected') FROM historical_envelope_fixture
UNION ALL SELECT ok(_historical_import_envelope_errors_v1(jsonb_set(payload,'{documents,0,source_sha256}',to_jsonb(repeat('b',64)))) @> '[{"code":"source_provenance_required"}]','Unknown source hash rejected') FROM historical_envelope_fixture
UNION ALL SELECT ok(NOT has_function_privilege('anon','public._historical_import_envelope_errors_v1(jsonb)','EXECUTE'),'Anon cannot execute private validator')
UNION ALL SELECT ok(NOT has_function_privilege('authenticated','public._historical_import_envelope_errors_v1(jsonb)','EXECUTE'),'Authenticated cannot bypass the future public import gate');
SELECT result FROM historical_envelope_tap ORDER BY id;
SELECT * FROM finish();
ROLLBACK;
