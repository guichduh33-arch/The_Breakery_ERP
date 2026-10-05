import { expect, it } from 'vitest';
import { validateRequestAttachment } from '../features/attachmentValidation';
it('accepts supported documents within the size limit',()=>{expect(()=>validateRequestAttachment({name:'surat.pdf',type:'application/pdf',size:1024})).not.toThrow();});
it('rejects empty, oversized and mismatched formats',()=>{for(const file of [{name:'surat.pdf',type:'application/pdf',size:0},{name:'surat.pdf',type:'application/pdf',size:5242881},{name:'script.html',type:'text/html',size:100},{name:'script.html',type:'application/pdf',size:100}])expect(()=>validateRequestAttachment(file)).toThrow();});
