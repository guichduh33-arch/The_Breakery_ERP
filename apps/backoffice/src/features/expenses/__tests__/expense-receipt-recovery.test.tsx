import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { ReactNode } from 'react';
import { useExpenseReceipt } from '../hooks/useExpenseReceipt.js';
import { ReceiptUploader } from '../components/ReceiptUploader.js';
import { ExpenseReceiptPanel } from '../components/ExpenseReceiptPanel.js';
import type { ExpenseRow } from '../hooks/useExpensesList.js';
import { receiptFileDigest } from '../utils/expenseReceiptFiles.js';
import { deferred, financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import { readFinancialSlot, runFinancialAttempt } from '@/lib/pendingFinancialAttempts.js';

const {rpc, upload, download} = vi.hoisted(() => ({
 rpc: vi.fn<(_name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>>(),
 upload: vi.fn(), download: vi.fn(),
}));
vi.mock('@/lib/supabase.js', () => ({supabase: {rpc, functions: {invoke: download}, storage: {from: () => ({upload})}}}));
vi.mock('@/stores/authStore.js', async () => ({useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth}));
const expenseId='00000000-0000-4000-8000-000000000001';
const scope={environment: import.meta.env.VITE_SUPABASE_URL as string, profileId:'profile-a', operation:'expense_receipt' as const, target: expenseId};
const noObject={data:null,error:{code:'P0002',message:'receipt_object_not_found'}};
const response=(args:Record<string,unknown>)=>({data:{expense_id:args.p_expense_id,receipt_path:args.p_storage_path??null,applied:true,idempotent_replay:false},error:null});
function wrapper({children}:{children:ReactNode}) {
 const qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
function file(content='receipt',type='application/pdf') {
 const f=new File([content],'untrusted.exe',{type});
 Object.defineProperty(f,'arrayBuffer',{configurable:true,value:()=>Promise.resolve(new TextEncoder().encode(content).buffer)});
 return f;
}
async function snapshot(f:File) {return {expenseId,expectedPath:null,kind:'attach' as const,mime:'application/pdf' as const,size:f.size,sha256:await receiptFileDigest(f)};}
function mountUploader(editable=true,value:string|null=null){const blocked=vi.fn();return {...render(<ReceiptUploader expenseId={expenseId} value={value} editable={editable} onBusyChange={blocked}/>,{wrapper}),blocked};}

describe('expense receipt durable recovery',()=>{
 beforeEach(()=>{vi.restoreAllMocks();installFinancialBrowser();resetFinancialSession();rpc.mockReset();upload.mockReset();download.mockReset();
  vi.stubGlobal('crypto',webcrypto);rpc.mockImplementation((_name: string,args: Record<string,unknown>)=>Promise.resolve(response(args)));upload.mockResolvedValue({data:{},error:null});});
 it('confirms before uploading, attaches under the real ID and never upserts',async()=>{
  rpc.mockResolvedValueOnce(noObject);const selected=file();const input=await snapshot(selected);
  const view=renderHook(()=>useExpenseReceipt(expenseId),{wrapper});
  await act(async()=>{await view.result.current.submit(input,selected);});
  expect(rpc).toHaveBeenCalledTimes(2);expect(upload).toHaveBeenCalledOnce();
  const path=upload.mock.calls[0]![0] as string;expect(path).toMatch(new RegExp('^expenses/'+expenseId+'/[a-f0-9-]+[.]pdf$'));
  expect(upload.mock.calls[0]![2]).toEqual({upsert:false,contentType:'application/pdf'});
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);expect(readFinancialSlot(scope)?.status).toBe('resolved');
 });
 it('checks an upload committed before its response was lost, without sending another file',async()=>{
  rpc.mockRejectedValueOnce(new TypeError('Response lost'));const input=await snapshot(file());
  const first=renderHook(()=>useExpenseReceipt(expenseId),{wrapper});await act(async()=>{await first.result.current.submit(input);});first.unmount();
  const next=renderHook(()=>useExpenseReceipt(expenseId),{wrapper});await act(async()=>{await next.result.current.submit(input);});
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);expect(upload).not.toHaveBeenCalled();expect(readFinancialSlot(scope)?.status).toBe('resolved');
 });
 it('rejects a different reselected file before any new HTTP request',async()=>{
  rpc.mockRejectedValueOnce(new Error('Response lost'));const input=await snapshot(file());
  const view=renderHook(()=>useExpenseReceipt(expenseId),{wrapper});await act(async()=>{await view.result.current.submit(input);});
  await act(async()=>{await view.result.current.submit(input,file('different'));});
  expect(rpc).toHaveBeenCalledOnce();expect(upload).not.toHaveBeenCalled();expect(readFinancialSlot(scope)?.status).toBe('pending');
 });
 it('confirms even when upload returned an ambiguous duplicate/error',async()=>{
  rpc.mockResolvedValueOnce(noObject);upload.mockResolvedValue({data:null,error:{message:'Response lost or object exists'}});
  const selected=file(),input=await snapshot(selected);const view=renderHook(()=>useExpenseReceipt(expenseId),{wrapper});
  await act(async()=>{await view.result.current.submit(input,selected);});expect(readFinancialSlot(scope)?.status).toBe('resolved');
 });
 it('does not turn a persisted draft-only refusal into success',async()=>{
  rpc.mockResolvedValue({data:{expense_id:expenseId,receipt_path:null,applied:false,idempotent_replay:false,reason:'receipt_requires_draft'},error:null});
  mountUploader();fireEvent.change(screen.getByLabelText('Receipt file'),{target:{files:[file()]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer allows');expect(screen.queryByText('Receipt change confirmed.')).not.toBeInTheDocument();
  expect(upload).not.toHaveBeenCalled();expect(readFinancialSlot(scope)?.status).toBe('resolved');
 });
 it('removes only the expense reference through RPC',async()=>{
  mountUploader(true,'expenses/historical/receipt.pdf');fireEvent.click(screen.getByRole('button',{name:'Remove receipt'}));
  expect(await screen.findByText('Receipt change confirmed.')).toBeInTheDocument();
  expect(rpc).toHaveBeenCalledWith('set_expense_receipt_v3',expect.objectContaining({p_expense_id:expenseId,p_expected_path:'expenses/historical/receipt.pdf'}));expect(upload).not.toHaveBeenCalled();
 });
 it('resolves a retained attempt after submission, without offering a new upload',async()=>{
  rpc.mockRejectedValueOnce(new Error('Response lost'));const input=await snapshot(file());
  const first=renderHook(()=>useExpenseReceipt(expenseId),{wrapper});await act(async()=>{await first.result.current.submit(input);});first.unmount();
  mountUploader(false);expect(screen.getByRole('button',{name:'Check pending receipt'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Check pending receipt'}));expect(await screen.findByText('Receipt change confirmed.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Receipt file')).not.toBeInTheDocument();expect(upload).not.toHaveBeenCalled();
 });
 it('ignores a hash finishing after the operator changed',async()=>{
  const bytes=deferred<ArrayBuffer>();const selected=file();Object.defineProperty(selected,'arrayBuffer',{configurable:true,value:()=>bytes.promise});
  mountUploader();fireEvent.change(screen.getByLabelText('Receipt file'),{target:{files:[selected]}});
  act(()=>{financialTestAuth.setState({sessionToken:'new-session'});});
  await act(async()=>{bytes.resolve(new TextEncoder().encode('receipt').buffer);await Promise.resolve();});
  expect(rpc).not.toHaveBeenCalled();expect(upload).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
 });
 it('rejects unsupported MIME without persisting a financial attempt',async()=>{
  mountUploader();fireEvent.change(screen.getByLabelText('Receipt file'),{target:{files:[file('bad','text/html')]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('JPEG or PDF');expect(rpc).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
 });
 it('shows a PDF receipt inline, privately, and downloads the same file',async()=>{
  const create=vi.fn((_b: Blob)=> 'blob:private-receipt'),revoke=vi.fn();
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:create});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revoke});
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>undefined);download.mockResolvedValue({data:new Blob(['private']),error:null});
  const view=render(<ExpenseReceiptPanel expense={{id:expenseId,status:'submitted',created_by:'profile-a',receipt_url:'expenses/old/receipt.pdf'} as ExpenseRow} onBusyChange={vi.fn()}/>,{wrapper});
  const frame=await screen.findByTitle('Receipt preview');expect(frame).toHaveAttribute('src','blob:private-receipt');
  expect(create.mock.calls[0]![0].type).toBe('application/pdf');expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(download).toHaveBeenCalledWith('download-expense-receipt',{body:{expense_id:expenseId},headers:{'x-session-token':'session-a-secret'}});
  fireEvent.click(screen.getByRole('button',{name:'Download receipt'}));expect(click).toHaveBeenCalledOnce();expect(download).toHaveBeenCalledOnce();
  view.unmount();expect(revoke).toHaveBeenCalledWith('blob:private-receipt');
 });
 it('shows an image receipt inline with its image type',async()=>{
  const create=vi.fn((_b: Blob)=> 'blob:private-image');Object.defineProperty(URL,'createObjectURL',{configurable:true,value:create});
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});download.mockResolvedValue({data:new Blob(['private']),error:null});
  render(<ExpenseReceiptPanel expense={{id:expenseId,status:'submitted',created_by:'profile-a',receipt_url:'expenses/old/receipt.JPG'} as ExpenseRow} onBusyChange={vi.fn()}/>,{wrapper});
  expect(await screen.findByRole('img',{name:'Receipt'})).toHaveAttribute('src','blob:private-image');expect(create.mock.calls[0]![0].type).toBe('image/jpeg');
 });
 it('discards a private preview when the session changed during IO',async()=>{
  // Le nouvel opérateur relance sa propre lecture : elle reste en vol, seule l'ancienne est résolue.
  const response=deferred<{data:Blob,error:null}>();download.mockReturnValueOnce(response.promise).mockReturnValue(new Promise(()=>undefined));
  const create=vi.fn();Object.defineProperty(URL,'createObjectURL',{configurable:true,value:create});
  render(<ExpenseReceiptPanel expense={{id:expenseId,status:'submitted',created_by:'profile-a',receipt_url:'expenses/old/receipt.pdf'} as ExpenseRow} onBusyChange={vi.fn()}/>,{wrapper});
  await waitFor(()=>expect(download).toHaveBeenCalledOnce());act(()=>{financialTestAuth.setState({sessionToken:'new-session'});});
  await act(async()=>{response.resolve({data:new Blob(['private']),error:null});await response.promise;});expect(create).not.toHaveBeenCalled();
 });
 it('allows a payer to regularize an approved expense with a missing invoice',()=>{
  financialTestAuth.setState({hasPermission:p=>p==='expenses.pay'});
  render(<ExpenseReceiptPanel expense={{id:expenseId,status:'approved',created_by:'other',receipt_url:null} as ExpenseRow} onBusyChange={vi.fn()}/>,{wrapper});
  expect(screen.getByLabelText('Receipt file')).toBeEnabled();expect(screen.queryByText('Remove receipt')).not.toBeInTheDocument();
 });
 it('offers repair after submission because a referenced file may be missing or invalid',()=>{
  render(<ExpenseReceiptPanel expense={{id:expenseId,status:'submitted',created_by:'profile-a',receipt_url:'expenses/'+expenseId+'/invoice.pdf'} as ExpenseRow} onBusyChange={vi.fn()}/>,{wrapper});
  expect(screen.getByLabelText('Receipt file')).toBeEnabled();expect(screen.queryByText('Remove receipt')).not.toBeInTheDocument();
  expect(screen.getByText(/Only missing or invalid receipts can be replaced/)).toBeInTheDocument();
 });
 it('keeps old PNG attempts readable for confirmation after upgrade',async()=>{
  const selected=file('legacy','image/png'); const input={expenseId,expectedPath:null,kind:'attach' as const,mime:'image/png' as const,size:selected.size,sha256:await receiptFileDigest(selected)};
  rpc.mockRejectedValueOnce(new Error('Response lost'));
  const first=renderHook(()=>useExpenseReceipt(expenseId),{wrapper});await act(async()=>{await first.result.current.submit(input);});first.unmount();
  const next=renderHook(()=>useExpenseReceipt(expenseId),{wrapper});await act(async()=>{await next.result.current.submit(input);});
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);expect(readFinancialSlot(scope)?.status).toBe('resolved');expect(upload).not.toHaveBeenCalled();
 });
 it.each(['image/png','image/webp'] as const)('resolves a local-only %s attempt without uploading it and starts a JPEG with a new key',async mime=>{
  const old=file('legacy',mime);
  const input={expenseId,expectedPath:null,kind:'attach' as const,mime,size:old.size,sha256:await receiptFileDigest(old)};
  await expect(runFinancialAttempt({scope,payload:input,expectedRevision:null,current:()=>true,
   send:()=>Promise.reject(new TypeError('Interrupted before reaching the server'))})).rejects.toThrow('Interrupted');
  const saved=readFinancialSlot(scope);
  const legacyKey=saved?.status==='pending'?saved.idempotencyKey:'';
  expect(legacyKey).not.toBe('');
  rpc.mockResolvedValue({data:{expense_id:expenseId,receipt_path:null,applied:false,idempotent_replay:false,reason:'legacy_upload_unavailable'},error:null});
  mountUploader();
  fireEvent.click(screen.getByRole('button',{name:'Check pending receipt'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your expense is retained. Choose a new JPEG or PDF invoice.');
  expect(readFinancialSlot(scope)?.status).toBe('resolved');expect(upload).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledOnce();expect(rpc.mock.calls[0]![1].p_idempotency_key).toBe(legacyKey);
  expect(screen.queryByText('Receipt change confirmed.')).not.toBeInTheDocument();
  const picker=screen.getByLabelText('Receipt file');expect(picker).toHaveAttribute('accept','image/jpeg,application/pdf');
  rpc.mockImplementation((_name:string,args:Record<string,unknown>)=>Promise.resolve(response(args))).mockResolvedValueOnce(noObject);
  fireEvent.change(picker,{target:{files:[file('replacement','image/jpeg')]}});
  expect(await screen.findByText('Receipt change confirmed.')).toBeInTheDocument();
  expect(upload).toHaveBeenCalledOnce();expect(upload.mock.calls[0]![0]).toMatch(/[.]jpg$/);
  expect(upload.mock.calls[0]![2]).toEqual({upsert:false,contentType:'image/jpeg'});
  expect(rpc.mock.calls[1]![1].p_idempotency_key).not.toBe(legacyKey);
  expect(rpc.mock.calls[2]).toEqual(rpc.mock.calls[1]);
  for(const [,args] of rpc.mock.calls) expect(args.p_expense_id).toBe(expenseId);
  expect(readFinancialSlot(scope)?.status).toBe('resolved');
 });
 it.each([
  {receipt_path:undefined},{receipt_path:42},{expense_id:'another-expense'},
  {applied:'false'},{idempotent_replay:'false'},{reason:'unknown_terminal_result'},
 ])('retains the pending attempt for a malformed terminal response %j',async invalid=>{
  const old=file('legacy','image/png');
  const input={expenseId,expectedPath:null,kind:'attach' as const,mime:'image/png' as const,size:old.size,sha256:await receiptFileDigest(old)};
  await expect(runFinancialAttempt({scope,payload:input,expectedRevision:null,current:()=>true,
   send:()=>Promise.reject(new TypeError('Interrupted before reaching the server'))})).rejects.toThrow('Interrupted');
  const saved=readFinancialSlot(scope);
  rpc.mockResolvedValue({data:{expense_id:expenseId,receipt_path:null,applied:false,idempotent_replay:false,
   reason:'legacy_upload_unavailable',...invalid},error:null});
  mountUploader();fireEvent.click(screen.getByRole('button',{name:'Check pending receipt'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('unconfirmed');
  expect(readFinancialSlot(scope)).toEqual(saved);expect(upload).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Check pending receipt'})).toBeInTheDocument();
  expect(screen.queryByLabelText('Receipt file')).not.toBeInTheDocument();
 });
 it('retains a contradictory legacy result even when its path matches the request',async()=>{
  const old=file('legacy','image/png');
  const input={expenseId,expectedPath:null,kind:'attach' as const,mime:'image/png' as const,size:old.size,sha256:await receiptFileDigest(old)};
  rpc.mockRejectedValueOnce(new Error('Response lost')).mockImplementation((_name:string,args:Record<string,unknown>)=>Promise.resolve({
   data:{...response(args).data,reason:'legacy_upload_unavailable'},error:null,
  }));
  const view=renderHook(()=>useExpenseReceipt(expenseId),{wrapper});
  await act(async()=>{await view.result.current.submit(input);});
  const saved=readFinancialSlot(scope);
  await act(async()=>{await view.result.current.submit(input);});
  expect(readFinancialSlot(scope)).toEqual(saved);expect(readFinancialSlot(scope)?.status).toBe('pending');
  expect(upload).not.toHaveBeenCalled();
 });
});
