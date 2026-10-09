"use client";
import { useState, type CSSProperties } from "react";
import { Check, CircleHelp, CircleMinus, ExternalLink, LockKeyhole, RotateCcw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import type { CheckStatus, VerifyResult } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CopyableHash, SectionCard, Timeline, TimelineItem, humanize } from "./design-system";
import { StatusBadge } from "./status-badge";
import { TRUST_COPY } from "./trust-strip";
import { roleLabel } from "./format";
const checks: {
    key: keyof VerifyResult["checks"];
    label: string;
    help: string;
}[] = [
    { key: "decrypt", label: "File opens securely", help: "Checks that the encrypted file decrypts with a valid authentication tag." },
    { key: "plaintextHash", label: "Content matches the original", help: "Compares the file’s SHA-256 hash with its signed original hash." },
    { key: "chunkRoot", label: "Every content chunk matches", help: "Compares 4 KB chunks to locate changes inside the file." },
    { key: "signature", label: "Uploader signature is valid", help: "The backend checks the ML-DSA-65 signature, off-chain." },
    { key: "merkleProof", label: "Included in its evidence batch", help: "Checks the document’s inclusion proof against the batch root." },
    { key: "onChainRoot", label: "Matches the blockchain record", help: "Compares the batch root with the recorded on-chain commitment." },
];
const checkLabels: Record<CheckStatus, string> = { pass: "Pass", fail: "Fail", skip: "Not checked" };
export function IntegrityPanel({ result, canRestore = false, documentName = "Evidence record", onRestore }: {
    result: VerifyResult;
    canRestore?: boolean;
    documentName?: string;
    onRestore?: (reason: string) => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function restore() {
        if (!reason.trim()) {
            setError("Explain why this version needs recovery.");
            return;
        }
        setBusy(true);
        setError("");
        try {
            if (!onRestore)
                throw new Error("Recovery is unavailable for this view. Open the evidence record.");
            await onRestore(reason.trim());
            setOpen(false);
            setReason("");
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Recovery failed");
            toast.error("Recovery could not be completed");
        }
        finally {
            setBusy(false);
        }
    }
    const tone = (status: CheckStatus) => status === "fail" ? "tone-danger" : status === "skip" ? "tone-neutral" : result.status === "VERIFIED" ? "tone-verified" : "tone-info";
    const restoreAction = result.status === "TAMPERED" && result.originalVersionAvailable && <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogTrigger asChild><Button disabled={!canRestore || !onRestore} title={!canRestore ? "An authorized document contributor must restore this evidence" : undefined} className="no-print"><RotateCcw />Restore original</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Restore the protected original?</AlertDialogTitle><AlertDialogDescription>S3 Object Lock retains the original. Recovery creates a new version; the damaged version and its audit history remain. The new version needs verification and anchoring.</AlertDialogDescription></AlertDialogHeader><div className="grid gap-2"><Label htmlFor="restore-reason">Recovery reason</Label><Input id="restore-reason" value={reason} onChange={e => setReason(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "restore-error" : undefined} placeholder="Reason for restoring this evidence"/>{error && <p id="restore-error" role="alert" className="text-xs text-tampered">{error}</p>}</div><AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep current version</AlertDialogCancel><Button onClick={() => void restore()} disabled={busy}>{busy ? "Submitting…" : "Confirm recovery"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
    const explorer = result.anchor?.explorerUrl;
    const safeExplorer = explorer && (explorer.startsWith("https://amoy.polygonscan.com/") || explorer.startsWith("https://polygonscan.com/") || explorer.startsWith("https://sepolia.etherscan.io/") || explorer.startsWith("https://etherscan.io/"));
    return <div className="space-y-5" aria-label="Integrity certificate">
 {result.status === "TAMPERED" ? <section className="rounded-xl border border-tampered/30 bg-tampered-surface p-5" aria-label="Integrity incident"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="section-label !text-tampered">Evidence needs attention</span><StatusBadge status={result.status}/></div><h2 className="break-words text-lg font-semibold">{documentName}</h2><p className="mt-1 text-sm text-tampered">This version differs from the protected original.</p><div className="my-4 space-y-2">{result.tamperRanges.length ? result.tamperRanges.map(range => <div className="flex items-start gap-2 rounded-lg border border-tampered/20 bg-card/60 p-3" key={range.chunkIndex}><ShieldAlert className="mt-0.5 size-4 shrink-0 text-tampered"/><div><p className="font-mono text-xs font-semibold">chunk {range.chunkIndex}, bytes {range.byteStart}–{range.byteEnd}</p><span className="text-xs text-muted-foreground">{humanize(range.kind)} · affected chunk range</span></div></div>) : <p className="text-xs">{result.checks.decrypt === "fail" ? "Content could not be decrypted; affected chunk unavailable." : "Tampering detected; range unavailable."}</p>}</div><div className="flex flex-wrap items-center gap-3">{restoreAction}<span className="flex items-center gap-1 text-xs text-muted-foreground"><LockKeyhole className="size-3"/>{result.originalVersionAvailable ? "Original retained by S3 Object Lock" : "No retained original reported"}</span></div>{result.originalVersionAvailable && !canRestore && <p className="mt-2 text-xs text-muted-foreground">An authorized document contributor must restore.</p>}<p className="mt-3 text-[11px] text-muted-foreground">Zero-based indices; the range identifies the affected chunk, not the exact changed byte.</p></section> : <SectionCard className="integrity-result" title="Integrity result" action={<StatusBadge status={result.status}/>}><p className="text-sm text-muted-foreground">{result.status === "VERIFIED" ? "All required checks are complete for this version." : result.status === "PENDING_ANCHOR" ? "Local checks are available. Blockchain confirmation is still pending." : result.status === "UNANCHORED" ? "This document has not been anchored to the blockchain." : "Verification could not finish. Retry before relying on this record."}</p>{restoreAction}</SectionCard>}
 <SectionCard title="Verification checklist" description="Checks for this version" action={<ShieldCheck className="size-5 text-primary"/>}><TooltipProvider><div className="divide-y">{checks.map((item, i) => { const status = result.checks[item.key]; const Icon = status === "pass" ? Check : status === "fail" ? X : CircleMinus; return <div key={item.key} className="check-reveal flex min-h-9 items-center justify-between gap-3 py-2" style={{ "--check-index": i } as CSSProperties}><div className="flex min-w-0 items-center gap-2"><span className="text-[10px] text-muted-foreground">0{i + 1}</span><Tooltip><TooltipTrigger asChild><button className="flex items-center gap-2 text-left text-xs font-medium" aria-label={item.label + ". " + item.help}>{item.label}<CircleHelp className="size-3 shrink-0 text-muted-foreground"/></button></TooltipTrigger><TooltipContent>{item.help}</TooltipContent></Tooltip></div><span className={"status-pill " + tone(status)}><Icon className="size-3"/>{checkLabels[status]}</span></div>; })}</div></TooltipProvider></SectionCard>
 {result.parts && <SectionCard title="Encrypted storage parts" description={result.parts.filter(p => p.status === "pass").length + "/" + result.parts.length + " parts verified"}><TooltipProvider><div className="flex flex-wrap gap-2">{result.parts.map(part => <Tooltip key={part.index}><TooltipTrigger asChild><button className={"flex min-h-11 min-w-12 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold " + tone(part.status)} aria-label={"Part " + part.index + ": " + checkLabels[part.status]}>{part.status === "pass" ? <Check className="size-3"/> : part.status === "fail" ? <X className="size-3"/> : <CircleMinus className="size-3"/>}{part.index}</button></TooltipTrigger><TooltipContent><p>Part {part.index} · bytes {part.byteStart}–{part.byteEnd}</p><p className="hash-value">{part.address}</p></TooltipContent></Tooltip>)}</div></TooltipProvider><details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Part addresses</summary>{result.parts.map(part => <div key={part.index} className="mt-2 flex flex-wrap items-center gap-2">Part {part.index}<CopyableHash value={part.address} label={"Part " + part.index + " address"}/></div>)}</details></SectionCard>}
 <SectionCard title="Recent accessors" description="Context for review, not proof of responsibility.">{result.lastAccessors.length ? <Timeline>{[...result.lastAccessors].sort((a, b) => a.at.localeCompare(b.at)).map((actor, i) => <TimelineItem key={i} title={actor.actorName} detail={roleLabel(actor.role) + " · " + humanize(actor.action)} at={actor.at}/>)}</Timeline> : <p className="text-sm text-muted-foreground">No accessor details are available.</p>}</SectionCard>
 <SectionCard title="Blockchain receipt" description={result.anchor ? "Batch #" + result.anchor.batchId + " · " + result.anchor.status : "No anchor receipt available"}>{result.anchor ? <div className="space-y-3"><p className="text-xs font-medium text-muted-foreground">{result.anchor.explorerUrl ? "Polygon" : "Local dev chain"}</p><div className="grid gap-3 sm:grid-cols-2"><div><p className="section-label">Root</p><CopyableHash value={result.anchor.root} label="On-chain root"/></div><div><p className="section-label">Transaction</p><CopyableHash value={result.anchor.txHash} label="Transaction hash"/></div></div>{safeExplorer && <Button variant="outline" asChild><a href={explorer!} target="_blank" rel="noreferrer">View transaction<ExternalLink /></a></Button>}</div> : <p className="text-xs text-muted-foreground">A transaction appears here once anchoring begins.</p>}<p className="mt-4 border-t pt-3 text-[11px] leading-5 text-muted-foreground">{TRUST_COPY}</p></SectionCard>
 </div>;
}
