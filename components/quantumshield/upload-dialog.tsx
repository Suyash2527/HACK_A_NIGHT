"use client";
import { useState } from "react";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES, type DocType, type UploadReceipt } from "@/types/api";
import { apiFetch, USE_MOCKS } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyableHash, Stepper, humanize } from "./design-system";
import { StatusBadge } from "./status-badge";
import { mockUpload, rememberMockUpload } from "./offline-demo-data";
import { formatBytes } from "./format";
export function UploadDialog({ caseId, allowedTypes, parentId, onComplete }: {
    caseId: string;
    allowedTypes: DocType[];
    parentId?: string;
    onComplete?: () => void;
}) {
    const [step, setStep] = useState(0), [file, setFile] = useState<File | null>(null), [type, setType] = useState<DocType>(allowedTypes[0]), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [receipt, setReceipt] = useState<UploadReceipt | null>(null);
    function validate() { if (!file || !type) {
        setError("Choose a file and document type.");
        return false;
    } if (!file.size || file.size > MAX_UPLOAD_BYTES) {
        setError("Choose a non-empty file no larger than 4 MB.");
        return false;
    } if (!(file.type in ALLOWED_UPLOAD_MIME)) {
        setError("Choose PDF, DOCX, TXT, PNG or JPG.");
        return false;
    } setError(""); return true; }
    async function submit() { if (!validate() || !file)
        return; setBusy(true); try {
        const form = { file, caseId, type, parentId };
        const result = await apiFetch("POST /api/documents", { form, mock: USE_MOCKS ? mockUpload(form) : undefined });
        if (USE_MOCKS)
            rememberMockUpload(result);
        setReceipt(result);
        setStep(2);
        toast.success(USE_MOCKS ? "Simulated upload receipt ready" : "Upload receipt ready");
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
        toast.error("Upload could not finish");
    }
    finally {
        setBusy(false);
    } }
    return <Dialog onOpenChange={open => { if (!open && receipt)
        onComplete?.(); if (open) {
        setStep(0);
        setReceipt(null);
        setError("");
    } }}><DialogTrigger asChild><Button disabled={!allowedTypes.length} title={!allowedTypes.length ? "Your role cannot upload to this case" : undefined}><FileUp />{parentId ? "Add new version" : "Upload document"}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{parentId ? "Add a linked evidence version" : "Upload evidence"}</DialogTitle><DialogDescription>Evidence is append-only. Original records and custody history are retained.</DialogDescription></DialogHeader><Stepper steps={["Choose file", "Confirm details", "Receipt"]} current={step}/>{step === 0 && <div className="grid gap-4"><div className="grid gap-2"><Label htmlFor="upload-type">Document type</Label><select id="upload-type" className="h-11 rounded-md border bg-background px-3 text-sm" value={type} onChange={e => setType(e.target.value as DocType)}>{allowedTypes.map(t => <option key={t} value={t}>{humanize(t)}</option>)}</select></div><div className="grid gap-2"><Label htmlFor="upload-file">Evidence file</Label><Input id="upload-file" type="file" accept={Object.values(ALLOWED_UPLOAD_MIME).join(",")} onChange={e => setFile(e.target.files?.[0] ?? null)}/><p className="text-xs text-muted-foreground">PDF, DOCX, TXT, PNG, JPG · maximum 4 MB</p></div></div>}{step === 1 && file && <div className="rounded-lg border bg-muted/40 p-4 text-sm"><p className="break-all font-semibold">{file.name}</p><p className="mt-2 text-muted-foreground">{humanize(type)} · {formatBytes(file.size)}</p><p className="mt-4 text-xs">{USE_MOCKS ? "Demo mode: the file is not uploaded or cryptographically processed. The next screen is a simulated receipt." : "Your file will be encrypted and signed. Blockchain anchoring is a separate step."}</p></div>}{step === 2 && receipt && <div className="space-y-4" aria-live="polite"><StatusBadge status={receipt.verification.status}/><p className="text-sm">{receipt.document.filename}</p><p className="text-xs text-muted-foreground">{receipt.encryption} · {receipt.keyWrapping}<br />{receipt.signature.algorithm}: {receipt.signature.status}</p><div><p className="section-label">Content hash</p><CopyableHash value={receipt.document.sha256}/></div><div><p className="section-label">Audit reference</p><CopyableHash value={receipt.auditEntryId} label="Audit reference"/></div></div>}{error && <p role="alert" className="text-sm text-tampered">{error}</p>}<DialogFooter showCloseButton>{step === 0 && <Button onClick={() => { if (validate())
        setStep(1); }}>Review upload</Button>}{step === 1 && <><Button variant="outline" disabled={busy} onClick={() => setStep(0)}>Back</Button><Button disabled={busy} onClick={() => void submit()}>{busy ? "Submitting…" : USE_MOCKS ? "Simulate upload" : "Encrypt and upload"}</Button></>}</DialogFooter></DialogContent></Dialog>;
}
