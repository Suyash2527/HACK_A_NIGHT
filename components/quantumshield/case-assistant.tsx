"use client";
import { useState } from "react";
import Link from "next/link";
import type { AssistantRequest, AssistantAnswer, Suggestion, JudgeBrief } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "./design-system";
import { useI18n } from "./i18n";
import { useSession } from "./session";
import { StatusBadge } from "./status-badge";
import { ExcludedDocuments, LegalChips } from "./legal-chip";

export function BriefSuggestion({ item }: { item: Suggestion }) {
  const { t } = useI18n();
  return <li className={"space-y-2 border-b border-l-4 py-3 pl-3 text-left [overflow-wrap:anywhere] " + (item.priority === "ACTION" ? "border-l-tampered" : "border-l-amber-600")}>
    <p className={"text-xs font-semibold " + (item.priority === "ACTION" ? "text-tampered" : "text-amber-800")}>{t(item.priority === "ACTION" ? "assistant.action" : "assistant.check")}</p>
    <h3 className="font-bold">{item.title}</h3><p>{item.detail}</p>
    <div className="flex flex-wrap gap-2">{item.docIds.map(id => <Link key={id} className="break-all text-sm underline" href={"/documents/" + id}>{id}</Link>)}</div>
    <LegalChips items={item.legal} />
  </li>;
}

export function AnswerResult({ value }: { value: AssistantAnswer }) {
  const { t } = useI18n();
  return <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
    <p className="text-sm font-semibold">{t(value.mode === "RETRIEVAL" ? "assistant.retrieval" : "assistant.model")}</p>
    <p className="whitespace-pre-wrap">{value.noAnswer ? t("assistant.noAnswer") : value.answer}</p>
    {value.citations.map((citation, index) => <figure key={citation.docId + index} className="space-y-2 border-l-2 pl-3">
      <blockquote className="whitespace-pre-wrap">{citation.quote}</blockquote>
      <figcaption className="flex flex-wrap items-center gap-2 text-sm">
        <Link className="underline" href={"/documents/" + citation.docId}>{citation.filename}</Link>
        <StatusBadge status={citation.verification.status} /><code>{citation.sha256.slice(0, 12)}</code>
      </figcaption>
    </figure>)}
    <LegalChips items={value.legal} /><ExcludedDocuments items={value.excluded} />
  </div>;
}

export function CaseAssistant({ caseId }: { caseId: string }) {
  const session = useSession();
  if (!session.assistantEnabled) return null;
  return <CaseAssistantPanels key={caseId} caseId={caseId} court={session.user.role === "JUDGE" || session.user.role === "ADMIN"} />;
}

function CaseAssistantPanels({ caseId, court }: { caseId: string; court: boolean }) {
  const { t, formatDate } = useI18n();
  const [brief, setBrief] = useState<JudgeBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState("");
  async function prepare() {
    setBriefBusy(true); setBriefError(""); setBrief(null);
    try { setBrief(await api("GET /api/assistant/judge-brief", { query: { caseId } })); }
    catch (error) { setBriefError(error instanceof Error ? error.message : t("assistant.failed")); }
    finally { setBriefBusy(false); }
  }
  async function ask() {
    if (!question.trim() || askBusy) return;
    setAskBusy(true); setAskError(""); setAnswer(null);
    const body: AssistantRequest = { caseId, question: question.trim() };
    try { setAnswer(await api("POST /api/assistant", { body })); }
    catch (error) { setAskError(error instanceof Error ? error.message : t("assistant.failed")); }
    finally { setAskBusy(false); }
  }
  return <>
    {court && <SectionCard title={t("assistant.brief")} action={<Button disabled={briefBusy} onClick={() => void prepare()}>{t("assistant.prepare")}</Button>}>
      <div className="space-y-3" aria-busy={briefBusy} aria-live="polite">
        {briefBusy && <p role="status">{t("assistant.verifying")}</p>}
        {briefError && <p role="alert" className="text-tampered">{briefError}</p>}
        {brief && <>
          <p className="text-sm text-muted-foreground">{t("assistant.checked", { n: brief.documentsChecked, at: formatDate(brief.generatedAt) })}</p>
          {brief.suggestions.length ? <ul>{[...brief.suggestions].sort((a, b) => Number(b.priority === "ACTION") - Number(a.priority === "ACTION")).map((item, index) => <BriefSuggestion key={index} item={item} />)}</ul> : <p>{t("assistant.noIssues")}</p>}
          <ExcludedDocuments items={brief.excluded} />
        </>}
      </div>
    </SectionCard>}
    <SectionCard title={t("assistant.askCase")}>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void ask(); }}>
        <label className="block text-sm font-medium" htmlFor="case-question">{t("assistant.question")}</label>
        <div className="flex gap-2"><Input id="case-question" className="min-w-0" maxLength={500} value={question} disabled={askBusy} onChange={event => setQuestion(event.target.value)} /><Button disabled={askBusy || !question.trim()} type="submit">{t("assistant.ask")}</Button></div>
        <div className="flex flex-wrap gap-2">{(["assistant.vehicle", "assistant.cctv", "assistant.seized"] as const).map(key => <Button key={key} type="button" variant="outline" className="h-auto max-w-full whitespace-normal text-left" disabled={askBusy} onClick={() => setQuestion(t(key))}>{t(key)}</Button>)}</div>
      </form>
      <div className="mt-4 space-y-3" aria-live="polite" aria-busy={askBusy}>
        {askBusy && <p role="status">{t("assistant.verifying")}</p>}
        {askError && <p role="alert" className="text-tampered">{askError}</p>}
        {answer && <AnswerResult value={answer} />}
      </div>
    </SectionCard>
  </>;
}
