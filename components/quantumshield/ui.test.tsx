import assert from "node:assert/strict";

import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";


import { StatusBadge } from "./status-badge";
import type { VerifyStatus } from "@/types/api";
function contrast(a: string, b: string) { const lum = (hex: string) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722; }; const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
test("court-register text palette meets AA contrast", () => { for (const fg of ["#1c1b19", "#5d5a52", "#c2410c", "#15803d", "#b91c1c", "#b45309"])
    assert.ok(contrast(fg, "#faf8f4") >= 4.5, fg); });
test("all verification states pair an icon with a label; only VERIFIED is green", () => { for (const status of ["VERIFIED", "TAMPERED", "PENDING_ANCHOR", "UNANCHORED", "ERROR"] as VerifyStatus[]) {
    const html = renderToStaticMarkup(createElement(StatusBadge, { status }));
    assert.match(html, /<svg/);
    assert.equal(html.includes("tone-verified"), status === "VERIFIED");
    assert.ok(!html.includes(">" + status + "<"));
} });
