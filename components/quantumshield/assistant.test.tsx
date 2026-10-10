import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdvocateSuggestion, AssistantAnswer, LegalRef } from "@/types/api";
import { eligibleSuggestions, AdvocateSuggestionsTable } from "./advocate-suggestions";
import { AnswerResult, BriefSuggestion } from "./case-assistant";
import { LegalChip, ExcludedDocuments } from "./legal-chip";

const legal: LegalRef = { id: "bsa63", ref: "BSA section 63", title: "Electronic evidence", text: "A summary of the requirements." };
const item: AdvocateSuggestion = { documentId: "doc-1", type: "FIR", filename: "FIR.txt", version: 1, latest: false, priority: "HIGH", why: "Review the initial record.", basisCode: "STATUTORY_DISCLOSURE", citation: "BNSS section 230", legal: [legal], requestStatus: null };

test("suggestions select HIGH records except pending or granted requests", () => {
  const items: AdvocateSuggestion[] = [item, { ...item, requestStatus: "PENDING" }, { ...item, requestStatus: "GRANTED" }, { ...item, requestStatus: "REJECTED" }, { ...item, requestStatus: "EXPIRED" }, { ...item, priority: "MEDIUM" }, { ...item, priority: "LOW" }];
  assert.deepEqual(eligibleSuggestions(items), [items[0], items[3], items[4]]);
});

test("legal summary disclaimer is visible outside the expandable official reference", () => {
  const html = renderToStaticMarkup(createElement(LegalChip, { value: legal }));
  assert.match(html, new RegExp("<summary[^>]*>BSA section 63</summary>"));
  assert.match(html, new RegExp("</details><p[^>]*>Summary · not the official text</p>"));
  assert.match(html, /Electronic evidence/);
});

test("excluded evidence remains visible with a red warning and document link", () => {
  const html = renderToStaticMarkup(createElement(ExcludedDocuments, { items: [{ docId: "failed-doc", filename: "Altered.txt", status: "TAMPERED", reason: "Hash mismatch" }] }));
  assert.match(html, /Not read: failed integrity check/);
  assert.ok(html.includes('href="/documents/failed-doc"'));
  assert.match(html, /tone-danger/);
});

test("answer preserves quotes, source links, verification and shortened hash", () => {
  const value: AssistantAnswer = { answer: "A vehicle was seen.", noAnswer: false, mode: "RETRIEVAL", legal: [legal], excluded: [], citations: [{ docId: "source", filename: "Statement.txt", quote: "I saw a white van.", sha256: "abcdef1234567890", verification: { status: "VERIFIED", checks: { decrypt: "pass", plaintextHash: "pass", chunkRoot: "pass", signature: "pass", merkleProof: "pass", onChainRoot: "pass" }, tamperRanges: [], lastAccessors: [], originalVersionAvailable: false } }] };
  const html = renderToStaticMarkup(createElement(AnswerResult, { value }));
  assert.match(html, /Quoted from verified documents/);
  assert.match(html, new RegExp("<blockquote[^>]*>I saw a white van.</blockquote>"));
  assert.ok(html.includes('href="/documents/source"'));
  assert.match(html, /tone-verified/);
  assert.ok(html.includes("<code>abcdef123456</code>"));
  const empty = renderToStaticMarkup(createElement(AnswerResult, { value: { ...value, mode: "MODEL", noAnswer: true, citations: [] } }));
  assert.match(empty, /Written by AI from the quoted passages/);
  assert.match(empty, /The verified documents you can access do not answer this./);
  assert.doesNotMatch(empty, /A vehicle was seen/);
});

test("brief action and check rows have distinct labelled rules", () => {
  for (const priority of ["ACTION", "CHECK"] as const) {
    const html = renderToStaticMarkup(createElement(BriefSuggestion, { item: { kind: "MISSING_RECORD", priority, title: "Review record", detail: "Confirm the record is complete.", docIds: ["source"], legal: [] } }));
    assert.match(html, priority === "ACTION" ? /border-l-tampered/ : /border-l-amber-600/);
    assert.match(html, priority === "ACTION" ? />Action</ : />Check</);
    assert.ok(html.includes('href="/documents/source"'));
  }
});

test("advocate table exposes versions and request state without evidence contents", () => {
  const html = renderToStaticMarkup(createElement(AdvocateSuggestionsTable, { value: { caseId: "case", firNo: "FIR", stage: "TRIAL", items: [item] }, onUse: () => {} }));
  for (const text of ["Suggested documents", "HIGH", "FIR.txt", "v1", "earlier version", "Review the initial record.", "none", "Use suggestions"]) assert.ok(html.includes(text), text);
  assert.match(html, /overflow-x-auto/);
});
