import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { POST as casesPost } from "../app/api/cases/route";
import { POST as docsPost } from "../app/api/documents/route";
import { POST as verifyPost } from "../app/api/documents/[id]/verify/route";
import { POST as attackPost } from "../app/api/demo/attack/route";
import { call, setup, uploadForm, userOf, type Harness } from "./helpers/api";

let h: Harness; let docId: string;
const police = userOf("POLICE").id, admin = userOf("ADMIN").id, judge = userOf("JUDGE").id;
const text = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => String.fromCharCode(65 + (i % 26))).join(""));

before(async () => {
  h = await setup();
  const c = await call(casesPost, "POST", { as: police, body: {} });
  docId = (await call(docsPost, "POST", { as: police, form: uploadForm(c.json.id, "FIR", "FIR.txt", text(20_000), "text/plain") })).json.document.id;
});
after(async () => { delete process.env.SAKSHYA_DEMO_ATTACK; await h.close(); });

describe("demo attack route", () => {
  it("is invisible (404) unless SAKSHYA_DEMO_ATTACK=1", async () => {
    delete process.env.SAKSHYA_DEMO_ATTACK;
    const r = await call(attackPost, "POST", { as: admin, body: { docId } });
    assert.equal(r.status, 404);
    assert.equal((await call(attackPost, "POST", { as: null as unknown as string, body: { docId } })).status, 401);
  });
  it("when enabled it is ADMIN-only and the tamper is then detected and localised", async () => {
    process.env.SAKSHYA_DEMO_ATTACK = "1";
    assert.equal((await call(attackPost, "POST", { as: judge, body: { docId } })).status, 403);
    assert.equal((await call(attackPost, "POST", { as: admin, body: { docId: "nope" } })).status, 422);
    assert.equal((await call(attackPost, "POST", { as: admin, body: { docId, offset: -5 } })).status, 422);
    assert.equal((await call(attackPost, "POST", { as: admin, body: { docId, offset: 99_999_999 } })).status, 422);
    const hit = await call(attackPost, "POST", { as: admin, body: { docId, offset: 9000 } });
    assert.equal(hit.status, 200);
    assert.equal(hit.json.partIndex, 0);
    const v = await call(verifyPost, "POST", { as: judge, params: { id: docId } });
    assert.equal(v.json.status, "TAMPERED");
    assert.equal(v.json.tamperRanges[0].chunkIndex, 2);
    assert.equal(v.json.tamperRanges[0].byteStart, 8192);
    assert.equal(v.json.tamperRanges[0].byteEnd, 12287);
  });
});
