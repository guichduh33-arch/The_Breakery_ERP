import { useEffect, useState } from 'react';
export function RequestAttachment({ file, staff }: { file: File; staff: boolean }) {
 const [url,setUrl]=useState('');
 useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next);},[file]);
 return <div className="hr-notice"><strong>{staff?'Lampiran':'Attachment'} · {file.name}</strong><p>{Math.ceil(file.size/1024)} KB · {staff?'Hanya di memori demo':'Demo memory only'}</p>{url && <a href={url} download={file.name}>{staff?'Unduh dokumen':'Download document'}</a>}</div>;
}
