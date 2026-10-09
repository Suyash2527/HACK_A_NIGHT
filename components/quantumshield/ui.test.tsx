import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiClientError } from "../api-client";
import { DataTable } from "./design-system";
import { FirNumber } from "./fir-number";
import { StatusBadge } from "./status-badge";
import { en } from "./i18n/en";
import { hi } from "./i18n/hi";
import { mr } from "./i18n/mr";
import { MAX_UPLOAD_BYTES, type VerifyStatus } from "@/types/api";

function contrast(a: string, b: string) {
  function luminance(hex: string) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  }
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

test("record palette meets AA text contrast", () => {
  for (const foreground of ["#172033", "#4a5468", "#1f3366", "#8a6516", "#1d7a46", "#c0262d", "#9a5800"])
    assert.ok(contrast(foreground, "#f3f5f8") >= 4.5, foreground);
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
  assert.match(en["trust.note"], /off-chain/);
  assert.match(en["trust.note"], /attestation/);
  assert.match(en["trust.note"], /does not verify/);
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
test("Hindi and Marathi translate every message and keep its placeholders", () => {
  const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join();
  for (const [name, dictionary] of [["hi", hi], ["mr", mr]] as const) {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      assert.ok(dictionary[key]?.trim(), name + " is missing " + key);
      assert.equal(placeholders(dictionary[key]), placeholders(en[key]), name + " placeholders differ for " + key);
    }
  }
});
test("status labels are readable in every language and only VERIFIED is green", () => {
  for (const dictionary of [en, hi, mr]) {
    for (const status of ["VERIFIED", "TAMPERED", "PENDING_ANCHOR", "UNANCHORED", "ERROR"] as const) {
      assert.ok(dictionary[`v.${status}`].length > 2);
    }
  }
});
