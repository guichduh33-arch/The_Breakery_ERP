import type { ExpenseReceiptSnapshot } from '@/lib/pendingFinancialAttemptSchema.js';
export const RECEIPT_ACCEPT='image/jpeg,image/png,image/webp,application/pdf';
export const RECEIPT_MAX_SIZE=5*1024*1024;
export const RECEIPT_EXTENSIONS: Record<string,string>={
 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf',
};
export function validateReceiptFile(file:File):asserts file is File & {type:Extract<ExpenseReceiptSnapshot,{kind:'attach'}>['mime']} {
 if(!Object.prototype.hasOwnProperty.call(RECEIPT_EXTENSIONS,file.type)) throw new Error('Choose a JPEG, PNG, WebP or PDF receipt.');
 if(file.size>RECEIPT_MAX_SIZE) throw new Error('Receipt is too large (max 5 MB).');
}
export async function receiptFileDigest(file:File):Promise<string> {
 validateReceiptFile(file);
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export function receiptPath(payload:Extract<ExpenseReceiptSnapshot,{kind:'attach'}>,key:string):string {
 return 'expenses/'+payload.expenseId+'/'+key+'.'+RECEIPT_EXTENSIONS[payload.mime];
}
