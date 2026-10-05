export function validateRequestAttachment(file: { name: string; size: number; type: string }): void {
 const formats: Record<string,string>={ 'application/pdf':'pdf', 'image/jpeg':'jpe?g', 'image/png':'png', 'image/webp':'webp' };
 const extension=formats[file.type];
 if(!extension || !new RegExp('\\.('+extension+')$','i').test(file.name)) throw new Error('Gunakan PDF, JPG, PNG atau WebP.');
 if(file.size===0 || file.size>5*1024*1024) throw new Error('Pilih dokumen berisi data, maksimal 5 MB.');
}
