"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, FileText, Trash2, Download } from "lucide-react";
import type { Attachment } from "@/lib/models";
import { uploadAttachment, deleteAttachment } from "./actions";

export function Attachments({ noteId, attachments, disabled }: { noteId: string; attachments: Attachment[]; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function upload(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("Choose a file smaller than 10 MB."); return; }
    setError("");
    const data = new FormData(); data.set("noteId", noteId); data.set("file", file);
    startTransition(async () => {
      try { const result = await uploadAttachment(data); if (!result.ok) setError(result.error); else router.refresh(); }
      catch { setError("Upload could not be confirmed. Refresh and check attachments before uploading again."); }
      if (input.current) input.current.value = "";
    });
  }

  function remove(id: string) {
    setError("");
    startTransition(async () => {
      try { const result = await deleteAttachment(id); if (!result.ok) setError(result.error); else { setConfirmId(null); router.refresh(); } }
      catch { setError("Deletion could not be confirmed. Refresh and check this attachment."); }
    });
  }

  return <section className="attachments" aria-label="Note attachments" aria-busy={pending}>
    <div className="attachments-head"><h3>Attachments{attachments.length ? ` · ${attachments.length}` : ""}</h3><button className="button button-secondary" type="button" disabled={disabled || pending} onClick={() => input.current?.click()}><Paperclip aria-hidden="true" />{pending ? "Working…" : "Attach a file"}</button></div>
    <input ref={input} type="file" className="sr-only" tabIndex={-1} accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md" aria-label="Choose attachment" disabled={disabled || pending} onChange={event => upload(event.target.files?.[0])} />
    {attachments.map(file => <div key={file.id} className="attachment-row"><FileText aria-hidden="true" /><a download={file.name} href={`/api/attachments/${file.id}`} className="text-link">{file.name}<small>{file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</small></a><a download={file.name} href={`/api/attachments/${file.id}`} className="icon-button" aria-label={`Download ${file.name}`}><Download aria-hidden="true" /></a><button className="icon-button" type="button" aria-label={`Delete ${file.name}`} disabled={disabled || pending} onClick={() => setConfirmId(file.id)}><Trash2 aria-hidden="true" /></button>{confirmId === file.id && <div className="delete-confirm attachment-confirm"><button type="button" className="button button-danger" disabled={pending} onClick={() => remove(file.id)}>Delete file</button><button type="button" className="button button-secondary" disabled={pending} onClick={() => setConfirmId(null)}>Keep</button></div>}</div>)}
    <p className="attachments-hint">{disabled ? "Save your changes before managing attachments." : "PDF, images, and text files. Up to 10 MB each."}</p>
    {error && <p className="notice notice-error mt-3" role="alert">{error}</p>}
  </section>;
}
