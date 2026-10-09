"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { CaseDetail, CreateCaseRequest } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useSession } from "./session";
import { FirNumber } from "./fir-number";
import { useI18n } from "./i18n";

const MAX_FIR_CHARS = 20000;

export function RegisterFir({ onCreated }: { onCreated: (record: CaseDetail) => void }) {
  const { t } = useI18n();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [place, setPlace] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [facts, setFacts] = useState("");
  const [firText, setFirText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CaseDetail | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || created) return;
    if (!firText.trim()) {
      setError(t("fir.needText"));
      return;
    }
    // The stored record keeps fixed English field names so every FIR reads the same in court.
    const text = [
      "Place: " + place.trim(),
      "Date and time (IST): " + occurredAt.replace("T", " "),
      "Brief facts: " + facts.trim(),
      "",
      firText.trim(),
    ].join("\n");
    if (text.length > MAX_FIR_CHARS) {
      setError(t("fir.tooLong"));
      return;
    }
    const body: CreateCaseRequest = { firText: text, ...(email.trim() ? { complainantEmail: email.trim() } : {}) };
    setBusy(true);
    setError("");
    try {
      setCreated(await api("POST /api/cases", { body }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("fir.failed"));
    } finally {
      setBusy(false);
    }
  }

  function changeOpen(next: boolean) {
    if (busy) return;
    if (!next && created) onCreated(created);
    if (next) {
      setCreated(null);
      setCopied(false);
      setError("");
      setEmail("");
      setPlace("");
      setOccurredAt("");
      setFacts("");
      setFirText("");
    }
    setOpen(next);
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.firNo);
      setCopied(true);
    } catch {
      setError(t("fir.copyFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button>{t("fir.register")}</Button></DialogTrigger>
      <DialogContent className="sm:!max-w-2xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{created ? t("fir.registered") : t("fir.register")}</DialogTitle>
          <DialogDescription>{created ? t("fir.keep") : t("fir.intro")}</DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-4" role="status">
            <p className="text-base text-muted-foreground">{t("fir.assigned")}</p>
            <div className="flex flex-wrap items-center gap-3 text-2xl">
              <FirNumber value={created.firNo} />
              <Button variant="outline" onClick={() => void copy()} aria-label={t("fir.copyAria")}>{copied ? t("common.copied") : t("common.copy")}</Button>
            </div>
            <p>{created.station}</p>
            <p className="text-base text-muted-foreground">{t("fir.saved")}</p>
            {error && <p role="alert" className="text-tampered">{error}</p>}
            <DialogFooter>
              <Button asChild><Link href={"/cases/" + created.id}>{t("fir.openCase")}</Link></Button>
              <Button variant="outline" onClick={() => changeOpen(false)}>{t("common.close")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-base"><span className="text-muted-foreground">{t("fir.station")}: </span>{session.user.station}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="fir-place">{t("fir.place")}</Label>
                <Input id="fir-place" required maxLength={200} value={place} onChange={e => setPlace(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fir-date">{t("fir.when")}</Label>
                <Input id="fir-date" type="datetime-local" required value={occurredAt} onChange={e => setOccurredAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fir-facts">{t("fir.facts")}</Label>
              <Input id="fir-facts" required maxLength={500} value={facts} onChange={e => setFacts(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fir-text">{t("fir.text")}</Label>
              <Textarea id="fir-text" required rows={10} maxLength={19000} className="min-h-64 text-base" value={firText} onChange={e => setFirText(e.target.value)} aria-describedby="fir-text-help" />
              <p id="fir-text-help" className="text-sm text-muted-foreground">{t("fir.textHelp")}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fir-email">{t("fir.email")}</Label>
              <Input id="fir-email" type="email" value={email} onChange={e => setEmail(e.target.value)} aria-describedby="fir-email-help" />
              <p id="fir-email-help" className="text-sm text-muted-foreground">{t("fir.emailHelp")}</p>
            </div>
            {error && <p role="alert" className="text-base text-tampered">{error}</p>}
            <DialogFooter>
              <Button variant="outline" type="button" disabled={busy} onClick={() => changeOpen(false)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={busy}>{busy ? t("fir.busy") : t("fir.submit")}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
