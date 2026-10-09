"use client";
import { useState, type FormEvent } from "react";
import { CheckCircle2, Search, ShieldAlert } from "lucide-react";
import { FIR_NUMBER_PATTERN, type FirCheck } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FirNumber } from "./fir-number";
import { useI18n } from "./i18n";

export function FirCheckBox() {
  const { t, formatDate } = useI18n();
  const [number, setNumber] = useState("");
  const [result, setResult] = useState<FirCheck | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function check(e: FormEvent) {
    e.preventDefault();
    const firNo = number.trim().toUpperCase();
    setResult(null);
    setError("");
    if (!FIR_NUMBER_PATTERN.test(firNo)) {
      setError(t("frc.format"));
      return;
    }
    setBusy(true);
    try {
      setResult(await api("GET /api/fir/check", { query: { firNo } }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("frc.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">{t("frc.desc")}</p>
      <form onSubmit={check} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="fir-check">{t("frc.label")}</Label>
          <Input
            id="fir-check"
            value={number}
            disabled={busy}
            onChange={e => { setNumber(e.target.value); setResult(null); setError(""); }}
            className="font-mono uppercase"
            placeholder="GNG/2026/0142/A3F9"
            autoCapitalize="characters"
            aria-invalid={!!error}
            aria-describedby={error ? "fir-check-error" : undefined}
          />
        </div>
        <Button type="submit" variant="outline" disabled={busy}><Search />{busy ? t("frc.checking") : t("frc.check")}</Button>
      </form>
      {error && <p id="fir-check-error" role="alert" className="mt-3 text-base text-tampered">{error}</p>}
      {result && (
        <div role="status" className={"mt-4 border p-3 " + (result.genuine ? "tone-verified" : "tone-danger")}>
          <p className="mb-2 text-base"><FirNumber value={result.firNo} /></p>
          <p className="flex items-start gap-2 text-base font-medium">
            {result.genuine ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0" />}
            {result.genuine
              ? result.issuedAt ? t("frc.genuine", { date: formatDate(result.issuedAt) }) : t("frc.genuineNoDate")
              : t("frc.notFound")}
          </p>
          {result.genuine && result.stationCode && <p className="mt-2 text-sm">{t("frc.station", { code: result.stationCode })}</p>}
        </div>
      )}
    </div>
  );
}
