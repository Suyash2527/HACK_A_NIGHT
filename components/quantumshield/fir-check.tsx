"use client";
import { useState, type FormEvent } from "react";
import { CheckCircle2, Search, ShieldAlert } from "lucide-react";
import { FIR_NUMBER_PATTERN, type FirCheck } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "./design-system";
import { FirNumber } from "./fir-number";
import { formatIST } from "./format";
export function FirCheckBox() {
    const [number, setNumber] = useState(""), [result, setResult] = useState<FirCheck | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    async function check(e: FormEvent) {
        e.preventDefault();
        const firNo = number.trim().toUpperCase();
        setResult(null);
        setError("");
        if (!FIR_NUMBER_PATTERN.test(firNo)) {
            setError("Use STATION/YEAR/SERIAL/CODE, for example GNG/2026/0142/A3F9.");
            return;
        }
        setBusy(true);
        try {
            setResult(await api("GET /api/fir/check", { query: { firNo } }));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "The register could not be checked. Please retry.");
        }
        finally {
            setBusy(false);
        }
    }
    return <SectionCard title="Check an FIR number" description="Confirm a number against the register. This does not verify the case evidence."><form onSubmit={check} className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1 space-y-2"><Label htmlFor="fir-check">FIR number</Label><Input id="fir-check" value={number} disabled={busy} onChange={e => { setNumber(e.target.value); setResult(null); setError(""); }} className="font-mono uppercase" placeholder="GNG/2026/0142/A3F9" autoCapitalize="characters" spellCheck aria-invalid={!!error} aria-describedby={error ? "fir-check-error" : undefined}/></div><Button type="submit" variant="outline" disabled={busy}><Search />{busy ? "Checking…" : "Check number"}</Button></form>{error && <p id="fir-check-error" role="alert" className="mt-3 text-sm text-tampered">{error}</p>}{result && <div role="status" className={"mt-4 rounded-lg border p-3 " + (result.genuine ? "tone-verified" : "tone-danger")}><p className="mb-2 text-sm"><FirNumber value={result.firNo}/></p><p className="flex items-start gap-2 text-sm font-medium">{result.genuine ? <CheckCircle2 className="mt-0.5 size-4 shrink-0"/> : <ShieldAlert className="mt-0.5 size-4 shrink-0"/>}{result.genuine ? "Genuine · " + (result.issuedAt ? "issued " + formatIST(result.issuedAt) : "issue date unavailable") : "Not found in the Sakshya register — number may be forged or mistyped"}</p>{result.genuine && result.stationCode && <p className="mt-2 text-xs">Station code: {result.stationCode}</p>}</div>}</SectionCard>;
}
