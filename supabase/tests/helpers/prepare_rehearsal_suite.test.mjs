import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSql, prepareTestFile } from './prepare_rehearsal_suite.mjs';

test('fixtures are inside the original rollback and RESET ROLE uses the authorized working role', () => {
  const sql = prepareSql('BEGIN;\nSELECT 1;\nRESET ROLE;\nROLLBACK;\n', 'SELECT fixture();');
  assert.ok(sql.indexOf('BEGIN;') < sql.indexOf('SELECT fixture();'));
  assert.ok(sql.indexOf('SELECT fixture();') < sql.indexOf('SELECT 1;'));
  assert.match(sql, /SET LOCAL ROLE postgres;/);
  assert.ok(sql.endsWith('ROLLBACK;\n'));
});
test('files outside the SQL test tree are refused before reading', () => {
  assert.throws(() => prepareTestFile('/tmp/untrusted.test.sql'));
});
test('missing or early rollback and explicit commit are refused', () => {
  for (const sql of ['SELECT 1;', 'BEGIN;\nCOMMIT;\nROLLBACK;',
    'BEGIN;\nROLLBACK;\nSELECT 1;', 'BEGIN;\nEND TRANSACTION;\nROLLBACK;']) {
    assert.throws(() => prepareSql(sql, 'SELECT fixture();'));
  }
});
