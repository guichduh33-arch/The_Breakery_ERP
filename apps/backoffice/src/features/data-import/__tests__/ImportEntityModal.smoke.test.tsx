// apps/backoffice/src/features/data-import/__tests__/ImportEntityModal.smoke.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportEntityModal } from '../components/ImportEntityModal.js';
import type { EntityImportDef } from '../entityImportDef.js';

const DEF: EntityImportDef = {
  entity: 'widgets', sheetName: 'Widgets', rpcName: 'import_widgets_v1',
  columns: [{ key: 'code', required: true, type: 'text' }],
  example: { code: 'W-1' }, queryKeysToInvalidate: [['widgets']],
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('ImportEntityModal', () => {
  it('renders the dropzone in the idle state', () => {
    render(wrap(<ImportEntityModal open def={DEF} title="Import suppliers" description="desc" onClose={() => {}} />));
    expect(screen.getByTestId('import-dropzone')).toBeInTheDocument();
    expect(screen.getByText('Import suppliers')).toBeInTheDocument();
  });

  it('renders nothing visible when closed', () => {
    render(wrap(<ImportEntityModal open={false} def={DEF} title="Import suppliers" description="desc" onClose={() => {}} />));
    expect(screen.queryByTestId('import-dropzone')).not.toBeInTheDocument();
  });
});
