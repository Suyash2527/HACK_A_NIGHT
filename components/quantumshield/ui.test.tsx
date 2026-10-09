import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiClientError } from "../api-client";
import { DataTable } from "./design-system";
import { FirNumber } from "./fir-number";
import { StatusBadge } from "./status-badge";
import { TRUST_COPY } from "./trust-strip";
import { MAX_UPLOAD_BYTES, type VerifyStatus } from "@/types/api";

function contrast(a: string, b: string) {
  function luminance(hex: string) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  }
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

test("court-register palette meets AA text contrast", () => {
  for (const foreground of ["#1c1b19", "#5d5a52", "#c2410c", "#15803d", "#b91c1c", "#b45309"])
    assert.ok(contrast(foreground, "#faf8f4") >= 4.5, foreground);
});
for (const status of ["VERIFIED", "TAMPERED", "PENDING_ANCHOR", "UNANCHORED", "ERROR"] as VerifyStatus[]) {
  test(status + " has a visible label and only VERIFIED is green", () => {
    const html = renderToStaticMarkup(createElement(StatusBadge, { status }));
    assert.match(html, /<svg/);
    assert.equal(html.includes("tone-verified"), status === "VERIFIED");
    assert.ok(html.replace(/<[^>]+>/g, "").trim().length > 0);
  });
}
test("unchecked evidence remains neutral and labelled", () => {
  const html = renderToStaticMarkup(createElement(StatusBadge, { status: null }));
  assert.ok(!html.includes("tone-verified"));
  assert.match(html, /Not checked|Unchecked/);
});
test("FIR code is distinct from an evidence verification claim", () => {
  const html = renderToStaticMarkup(createElement(FirNumber, { value: "GNG/2026/0001/A3F9" }));
  assert.match(html, /font-mono/);
  assert.match(html, /Register verification code/);
  assert.match(html, /A3F9/);
  assert.ok(!html.includes("tone-verified"));
});
test("forty records render twenty rows with page controls", () => {
  const html = renderToStaticMarkup(createElement(DataTable<number>, {
    rows: Array.from({length:40}, (_, i) => i + 1), rowKey: String, searchText: String,
    columns: [{key:"record", label:"Record", sort: Number, render: String}]
  }));
  assert.equal((html.match(/data-slot="table-row"/g) ?? []).length, 21);
  assert.match(html, /Page 1 of 2/);
  assert.match(html, /40 records/);
  assert.match(html, /Next page/);
});
test("API errors preserve the server message", () => {
  const error = new ApiClientError(409, {error:{code:"TAMPERED",message:"Content differs from the signed original."}});
  assert.equal(error.message,"Content differs from the signed original.");
  assert.equal(error.status,409);
});
test("trust wording distinguishes verification from blockchain storage", () => {
  assert.match(TRUST_COPY, /off-chain/);
  assert.match(TRUST_COPY, /attestation/);
  assert.match(TRUST_COPY, /does not verify/);
});
test("reduced motion and bounded document grids are explicit", () => {
  const css=readFileSync("app/globals.css","utf8");
  assert.ok(css.includes("prefers-reduced-motion:reduce"));
  assert.ok(css.includes("animation:none!important"));
  assert.ok(css.includes(".document-columns > *"));
  assert.ok(css.includes("min-height:44px"));
});
test("upload limit remains the contract's four MiB boundary", () => {
  assert.equal(MAX_UPLOAD_BYTES,4194304);
});
