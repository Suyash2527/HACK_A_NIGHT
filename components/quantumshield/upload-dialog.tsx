"use client";
import { useState } from "react";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES, type DocType, type UploadReceipt } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyableHash } from "./design-system";
import { StatusBadge } from "./status-badge";
import { formatBytes } from "./format";
import { useI18n } from "./i18n";

export function UploadDialog({ caseId, allowedTypes, parentId, onComplete, label, secondary = false }: {
  caseId: string;
  allowedTypes: DocType[];
  parentId?: string;
  onComplete?: () => void;
  label?: string;
  secondary?: boolean;
}) {
  const { t, label: enumLabel } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<DocType>(allowedTypes[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<UploadReceipt | null>(null);

  function problem() {
    if (!file || !type) return t("up.needBoth");
    if (!file.size || file.size > MAX_UPLOAD_BYTES) return t("up.tooBig");
    if (!(file.type in ALLOWED_UPLOAD_MIME)) return t("up.badType");
    return "";
  }

  async function submit() {
    const found = problem();
    setError(found);
    if (found || !file) return;
    setBusy(true);
    try {
      setReceipt(await api("POST /api/documents", { form: { file, caseId, type, parentId } }));
      toast.success(t("up.toastOk"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("up.failed"));
      toast.error(t("up.toastFail"));
    } finally {
      setBusy(false);
    }
  }

  function changeOpen(open: boolean) {
    if (!open && receipt) onComplete?.();
    if (open) {
      setFile(null);
      setReceipt(null);
      setError("");
    }
  }

  return (
    <Dialog onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant={secondary ? "outline" : "default"} disabled={!allowedTypes.length} title={!allowedTypes.length ? t("up.cannot") : undefined}>
          <FileUp />{label ?? t(parentId ? "up.newVersion" : "up.button")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(parentId ? "up.titleVersion" : "up.title")}</DialogTitle>
          <DialogDescription>{t("up.desc")}</DialogDescription>
        </DialogHeader>
        {receipt ? (
          <div className="space-y-4" aria-live="polite">
            <StatusBadge status={receipt.verification.status} />
            <p className="text-lg font-semibold">{t("up.receipt")}</p>
            <p className="break-all text-base">{receipt.document.filename}</p>
            <p className="text-base text-muted-foreground">{t("up.receiptNote")}</p>
            <div><p className="section-label">{t("up.fingerprint")}</p><CopyableHash value={receipt.document.sha256} /></div>
            <div><p className="section-label">{t("up.reference")}</p><CopyableHash value={receipt.auditEntryId} label={t("up.reference")} /></div>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="upload-type">{t("up.type")}</Label>
              <select id="upload-type" className="h-11 border bg-background px-3 text-base" value={type} onChange={e => setType(e.target.value as DocType)}>
                {allowedTypes.map(value => <option key={value} value={value}>{enumLabel(value)}</option>)}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="upload-file">{t("up.file")}</Label>
              <Input id="upload-file" type="file" accept={Object.values(ALLOWED_UPLOAD_MIME).join(",")} onChange={e => setFile(e.target.files?.[0] ?? null)} />
              <p className="text-sm text-muted-foreground">
                {file ? t("up.chosen", { name: file.name, size: formatBytes(file.size) }) : t("up.fileHelp")}
              </p>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-base text-tampered">{error}</p>}
        <DialogFooter showCloseButton>
          {!receipt && <Button disabled={busy} onClick={() => void submit()}>{busy ? t("up.busy") : t("up.submit")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
