"use client";
import type { AdvocateSuggestion, AdvocateSuggestions } from "@/types/api";
import { Button } from "@/components/ui/button";
import { LegalChips } from "./legal-chip";
import { useI18n } from "./i18n";

export function eligibleSuggestions(items: AdvocateSuggestion[]) {
  return items.filter(item => item.priority === "HIGH" && item.requestStatus !== "PENDING" && item.requestStatus !== "GRANTED");
}

export function AdvocateSuggestionsTable({ value, onUse }: { value: AdvocateSuggestions; onUse: (items: AdvocateSuggestion[]) => void }) {
  const { t, label } = useI18n();
  const eligible = eligibleSuggestions(value.items);
  return <section className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t("assistant.suggested")}</h3><Button type="button" variant="outline" disabled={!eligible.length} onClick={() => onUse(eligible)}>{t("assistant.use")}</Button></div>
    <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label={t("assistant.suggested")}>
      <table className="w-full border-collapse text-left text-sm">
        <thead><tr className="border-y">{(["assistant.priority", "assistant.type", "col.document", "assistant.why", "assistant.legal", "col.status"] as const).map(key => <th className="p-2 align-top font-semibold" key={key}>{t(key)}</th>)}</tr></thead>
        <tbody>{value.items.map(item => <tr className="border-b" key={item.documentId}>
          <td className="p-2 align-top">{t(item.priority === "HIGH" ? "assistant.high" : item.priority === "MEDIUM" ? "assistant.medium" : "assistant.low")}</td>
          <td className="p-2 align-top">{label(item.type)}</td>
          <td className="min-w-32 p-2 align-top [overflow-wrap:anywhere]">{item.filename} <span>{t("assistant.version", { v: item.version })}</span>{!item.latest && <p>{t("assistant.earlier")}</p>}</td>
          <td className="min-w-44 p-2 align-top">{item.why}</td><td className="min-w-44 p-2 align-top"><LegalChips items={item.legal} /></td>
          <td className="p-2 align-top"><span className={"status-pill " + (item.requestStatus === "REJECTED" ? "tone-danger" : item.requestStatus === "PENDING" ? "tone-pending" : item.requestStatus === "GRANTED" ? "tone-info" : "tone-neutral")}>{item.requestStatus ? label(item.requestStatus) : t("assistant.none")}</span></td>
        </tr>)}</tbody>
      </table>
    </div>
    {!value.items.length && <p>{t("assistant.noSuggestions")}</p>}
  </section>;
}
