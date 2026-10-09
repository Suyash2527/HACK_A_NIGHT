import { expect } from "chai";
import { network } from "hardhat";
import { AbiCoder, keccak256, sha256, toUtf8Bytes, ZeroHash, type BytesLike } from "ethers";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { CRYPTO_PROFILE_V1 } from "../config/networks.ts";
import { indexEvents } from "../scripts/lib/indexer.ts";

const { ethers, networkHelpers } = await network.getOrCreate();

const h = (s: string) => sha256(toUtf8Bytes(s));
const PROFILE_HASH = h(CRYPTO_PROFILE_V1.descriptor);
const enum Verdict { None, Valid, Invalid }
const enum Action {
  Upload, View, Download, Verify, Denied, Anchor, Scan, TamperDetected, Restore,
  RequestFiled, RequestGranted, RequestRejected, FolderAssembled, MilestoneAdded, ManifestSealed,
}
const ACTION_COUNT = 15;

function recordInput(over: Partial<Record<string, unknown>> = {}) {
  return {
    documentHash: h("fir-001.pdf plaintext"),
    chunkRoot: h("chunk-root"),
    signatureHash: h("ml-dsa signature bytes"),
    signerKeyHash: h("ml-dsa public key"),
    parentRecordId: ZeroHash,
    version: 1,
    profileId: 1,
    ...over,
  };
}

async function deployFixture() {
  const [admin, recorder, verifier, outsider, verifier2] = await ethers.getSigners();
  const registry = await ethers.deployContract("SakshyaRegistry", [
    admin.address,
    recorder.address,
    verifier.address,
    PROFILE_HASH,
  ]);
  const deployBlock = (await registry.deploymentTransaction()!.wait())!.blockNumber;
  return { registry, admin, recorder, verifier, outsider, verifier2, deployBlock };
}

async function withRecord() {
  const f = await deployFixture();
  const recordId = h("qs:doc:11111111-1111-1111-1111-111111111111");
  await f.registry.connect(f.recorder).registerRecord(recordId, recordInput());
  return { ...f, recordId };
}

describe("SakshyaRegistry", () => {
  describe("deployment", () => {
    it("grants roles and registers crypto profile 1", async () => {
      const { registry, admin, recorder, verifier } = await networkHelpers.loadFixture(deployFixture);
      expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await registry.hasRole(await registry.PAUSER_ROLE(), admin.address)).to.equal(true);
      expect(await registry.hasRole(await registry.RECORDER_ROLE(), recorder.address)).to.equal(true);
      expect(await registry.hasRole(await registry.VERIFIER_ROLE(), verifier.address)).to.equal(true);
      expect(await registry.hasRole(await registry.RECORDER_ROLE(), admin.address)).to.equal(false);
      const p = await registry.getCryptoProfile(1);
      expect(p.descriptorHash).to.equal(PROFILE_HASH);
      expect(p.active).to.equal(true);
    });

    it("rejects zero addresses and a zero profile hash", async () => {
      const [a] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("SakshyaRegistry");
      await expect(ethers.deployContract("SakshyaRegistry", [ethers.ZeroAddress, a.address, a.address, PROFILE_HASH]))
        .to.be.revertedWithCustomError(factory, "ZeroAddress");
      await expect(ethers.deployContract("SakshyaRegistry", [a.address, a.address, a.address, ZeroHash]))
        .to.be.revertedWithCustomError(factory, "ZeroValue").withArgs("descriptorHash");
    });
  });

  describe("registerRecord", () => {
    it("stores commitments only and emits RecordRegistered", async () => {
      const { registry, recorder } = await networkHelpers.loadFixture(deployFixture);
      const id = h("qs:doc:a");
      const input = recordInput();
      await expect(registry.connect(recorder).registerRecord(id, input))
        .to.emit(registry, "RecordRegistered")
        .withArgs(id, input.documentHash, ZeroHash, 1, 1, input.chunkRoot, input.signatureHash, input.signerKeyHash, recorder.address);
      const r = await registry.getRecord(id);
      expect(r.documentHash).to.equal(input.documentHash);
      expect(r.recorder).to.equal(recorder.address);
      expect(r.registeredAt).to.be.greaterThan(0n);
      expect(await registry.isRegistered(id)).to.equal(true);
    });

    it("rejects duplicate recordIds", async () => {
      const { registry, recorder, recordId } = await networkHelpers.loadFixture(withRecord);
      await expect(registry.connect(recorder).registerRecord(recordId, recordInput()))
        .to.be.revertedWithCustomError(registry, "RecordAlreadyRegistered").withArgs(recordId);
    });

    it("rejects unauthorized callers (admin, verifier, outsider)", async () => {
      const { registry, admin, verifier, outsider } = await networkHelpers.loadFixture(deployFixture);
      const role = await registry.RECORDER_ROLE();
      for (const s of [admin, verifier, outsider]) {
        await expect(registry.connect(s).registerRecord(h("x"), recordInput()))
          .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount").withArgs(s.address, role);
      }
    });

    it("rejects zero-valued inputs", async () => {
      const { registry, recorder } = await networkHelpers.loadFixture(deployFixture);
      await expect(registry.connect(recorder).registerRecord(ZeroHash, recordInput()))
        .to.be.revertedWithCustomError(registry, "ZeroValue").withArgs("recordId");
      for (const field of ["documentHash", "chunkRoot", "signatureHash", "signerKeyHash"]) {
        await expect(registry.connect(recorder).registerRecord(h(field), recordInput({ [field]: ZeroHash })))
          .to.be.revertedWithCustomError(registry, "ZeroValue").withArgs(field);
      }
    });

    it("rejects unknown and inactive crypto profiles", async () => {
      const { registry, admin, recorder } = await networkHelpers.loadFixture(deployFixture);
      await expect(registry.connect(recorder).registerRecord(h("p"), recordInput({ profileId: 7 })))
        .to.be.revertedWithCustomError(registry, "UnknownProfile").withArgs(7);
      await registry.connect(admin).setCryptoProfile(1, PROFILE_HASH, false);
      await expect(registry.connect(recorder).registerRecord(h("p"), recordInput()))
        .to.be.revertedWithCustomError(registry, "InactiveProfile").withArgs(1);
    });

    it("enforces version lineage for corrections", async () => {
      const { registry, recorder, recordId } = await networkHelpers.loadFixture(withRecord);
      await expect(registry.connect(recorder).registerRecord(h("orig-v2"), recordInput({ version: 2 })))
        .to.be.revertedWithCustomError(registry, "InvalidVersion").withArgs(2, 0);
      await expect(registry.connect(recorder).registerRecord(h("v2"), recordInput({ parentRecordId: h("missing"), version: 2 })))
        .to.be.revertedWithCustomError(registry, "RecordNotFound").withArgs(h("missing"));
      await expect(registry.connect(recorder).registerRecord(h("v2"), recordInput({ parentRecordId: recordId, version: 1 })))
        .to.be.revertedWithCustomError(registry, "InvalidVersion").withArgs(1, 1);
      await expect(registry.connect(recorder).registerRecord(h("v2"), recordInput({ parentRecordId: recordId, version: 2 })))
        .to.emit(registry, "RecordRegistered");
      expect((await registry.getRecord(h("v2"))).parentRecordId).to.equal(recordId);
    });
  });

  describe("attestSignature (off-chain ML-DSA-65 verdicts)", () => {
    it("full trust flow: sign off-chain, verify off-chain, attest on-chain, re-verify independently", async () => {
      const { registry, recorder, verifier } = await networkHelpers.loadFixture(deployFixture);
      // --- backend (off-chain): uploader signs canonical payload with ML-DSA-65
      const keys = ml_dsa65.keygen(new Uint8Array(32).fill(7));
      const ctx = new TextEncoder().encode("judicial-dms/doc-sig/v1");
      const docHash = h("witness statement plaintext");
      const payload = new TextEncoder().encode(JSON.stringify({ caseId: "c1", docType: "WITNESS_STATEMENT", sha256: docHash, version: 1 }));
      const sig = ml_dsa65.sign(payload, keys.secretKey, { context: ctx });
      const recordId = h("qs:doc:flow");
      await registry.connect(recorder).registerRecord(recordId, recordInput({
        documentHash: docHash,
        signatureHash: sha256(sig),
        signerKeyHash: sha256(keys.publicKey),
      }));
      // --- verifier service (off-chain): verifies, then commits verdict + evidence hash on-chain
      const valid = ml_dsa65.verify(sig, payload, keys.publicKey, { context: ctx });
      expect(valid).to.equal(true);
      const evidence = JSON.stringify({ recordId, alg: "ML-DSA-65", signatureHash: sha256(sig), publicKeyHash: sha256(keys.publicKey), result: valid });
      await expect(registry.connect(verifier).attestSignature(recordId, Verdict.Valid, h(evidence)))
        .to.emit(registry, "SignatureAttested")
        .withArgs(recordId, verifier.address, Verdict.Valid, 1, h(evidence));
      // --- independent auditor: fetches sig + pubkey off-chain, checks them against on-chain commitments
      const onChain = await registry.getRecord(recordId);
      expect(onChain.signatureHash).to.equal(sha256(sig));
      expect(onChain.signerKeyHash).to.equal(sha256(keys.publicKey));
      expect(ml_dsa65.verify(sig, payload, keys.publicKey, { context: ctx })).to.equal(true);
      const a = await registry.getAttestation(recordId, verifier.address);
      expect(a.verdict).to.equal(BigInt(Verdict.Valid));
      expect(a.evidenceHash).to.equal(h(evidence));
      // tampered signature would not match the on-chain commitment
      const forged = Uint8Array.from(sig); forged[0] ^= 1;
      expect(sha256(forged)).to.not.equal(onChain.signatureHash);
      expect(ml_dsa65.verify(forged, payload, keys.publicKey, { context: ctx })).to.equal(false);
    });

    it("records an Invalid verdict and allows multiple independent verifiers", async () => {
      const { registry, admin, verifier, verifier2, recordId } = await networkHelpers.loadFixture(withRecord);
      await registry.connect(admin).grantRole(await registry.VERIFIER_ROLE(), verifier2.address);
      await registry.connect(verifier).attestSignature(recordId, Verdict.Valid, h("e1"));
      await registry.connect(verifier2).attestSignature(recordId, Verdict.Invalid, h("e2"));
      expect((await registry.getAttestation(recordId, verifier2.address)).verdict).to.equal(BigInt(Verdict.Invalid));
    });

    it("rejects duplicate attestation, None verdict, zero evidence, unknown record", async () => {
      const { registry, verifier, recordId } = await networkHelpers.loadFixture(withRecord);
      await registry.connect(verifier).attestSignature(recordId, Verdict.Valid, h("e"));
      await expect(registry.connect(verifier).attestSignature(recordId, Verdict.Invalid, h("e2")))
        .to.be.revertedWithCustomError(registry, "AlreadyAttested").withArgs(recordId, verifier.address);
      await expect(registry.connect(verifier).attestSignature(recordId, Verdict.None, h("e")))
        .to.be.revertedWithCustomError(registry, "InvalidVerdict");
      await expect(registry.connect(verifier).attestSignature(recordId, Verdict.Valid, ZeroHash))
        .to.be.revertedWithCustomError(registry, "ZeroValue").withArgs("evidenceHash");
      await expect(registry.connect(verifier).attestSignature(h("nope"), Verdict.Valid, h("e")))
        .to.be.revertedWithCustomError(registry, "RecordNotFound").withArgs(h("nope"));
    });

    it("rejects out-of-range verdict enum values", async () => {
      const { registry, verifier, recordId } = await networkHelpers.loadFixture(withRecord);
      await expect(registry.connect(verifier).attestSignature(recordId, 3, h("e"))).to.be.revert(ethers);
    });

    it("rejects attestation from non-verifiers (recorder cannot grade its own records)", async () => {
      const { registry, recorder, outsider, recordId } = await networkHelpers.loadFixture(withRecord);
      const role = await registry.VERIFIER_ROLE();
      for (const s of [recorder, outsider]) {
        await expect(registry.connect(s).attestSignature(recordId, Verdict.Valid, h("e")))
          .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount").withArgs(s.address, role);
      }
    });
  });

  describe("logAuditEvent", () => {
    it("builds a hash chain that can be recomputed off-chain", async () => {
      const { registry, recorder, recordId } = await networkHelpers.loadFixture(withRecord);
      const coder = AbiCoder.defaultAbiCoder();
      let head: BytesLike = ZeroHash;
      const steps: [Action, string, string][] = [
        [Action.Upload, h("actor:police"), h("audit:1")],
        [Action.View, h("actor:prosecutor"), h("audit:2")],
        [Action.Verify, h("actor:judge"), h("audit:3")],
      ];
      for (const [i, [action, actor, ev]] of steps.entries()) {
        const tx = await registry.connect(recorder).logAuditEvent(recordId, action, actor, ev);
        const ts = BigInt((await ethers.provider.getBlock((await tx.wait())!.blockNumber))!.timestamp);
        head = keccak256(coder.encode(
          ["bytes32", "bytes32", "uint32", "uint8", "bytes32", "bytes32", "uint64"],
          [head, recordId, i + 1, action, actor, ev, ts],
        ));
        await expect(tx).to.emit(registry, "AuditEventLogged").withArgs(recordId, action, actor, ev, head, i + 1, ts);
      }
      const s = await registry.getAuditState(recordId);
      expect(s.head).to.equal(head);
      expect(s.count).to.equal(3n);
    });

    it("rejects replayed events, invalid actions, zero hashes, unknown records, outsiders", async () => {
      const { registry, recorder, outsider, recordId } = await networkHelpers.loadFixture(withRecord);
      await registry.connect(recorder).logAuditEvent(recordId, Action.View, h("a"), h("ev"));
      await expect(registry.connect(recorder).logAuditEvent(recordId, Action.View, h("a"), h("ev")))
        .to.be.revertedWithCustomError(registry, "AuditEventReplayed").withArgs(h("ev"));
      await expect(registry.connect(recorder).logAuditEvent(recordId, ACTION_COUNT, h("a"), h("ev2")))
        .to.be.revertedWithCustomError(registry, "InvalidAction").withArgs(ACTION_COUNT);
      await expect(registry.connect(recorder).logAuditEvent(recordId, Action.View, ZeroHash, h("ev2")))
        .to.be.revertedWithCustomError(registry, "ZeroValue").withArgs("actorHash");
      await expect(registry.connect(recorder).logAuditEvent(recordId, Action.View, h("a"), ZeroHash))
        .to.be.revertedWithCustomError(registry, "ZeroValue").withArgs("eventHash");
      await expect(registry.connect(recorder).logAuditEvent(h("nope"), Action.View, h("a"), h("ev3")))
        .to.be.revertedWithCustomError(registry, "SubjectNotFound").withArgs(h("nope"));
      await expect(registry.connect(outsider).logAuditEvent(recordId, Action.View, h("a"), h("ev4")))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("sealCaseManifest (case folder)", () => {
    const caseRef = h("qs:case:11111111-1111-4111-8111-111111111111");

    it("seals sequential versions; each version's root stays readable", async () => {
      const { registry, recorder } = await networkHelpers.loadFixture(deployFixture);
      await expect(registry.connect(recorder).sealCaseManifest(caseRef, 1, h("root-v1"), 1))
        .to.emit(registry, "CaseManifestSealed").withArgs(caseRef, 1, h("root-v1"), 1);
      await registry.connect(recorder).sealCaseManifest(caseRef, 2, h("root-v2"), 3);
      const latest = await registry.getCaseManifest(caseRef);
      expect(latest.version).to.equal(2n);
      expect(latest.root).to.equal(h("root-v2"));
      expect(latest.documentCount).to.equal(3n);
      expect(await registry.getManifestRoot(caseRef, 1)).to.equal(h("root-v1"));
    });

    it("rejects skipped, repeated or rewound versions (folder can only grow)", async () => {
      const { registry, recorder } = await networkHelpers.loadFixture(deployFixture);
      await expect(registry.connect(recorder).sealCaseManifest(caseRef, 2, h("r"), 1))
        .to.be.revertedWithCustomError(registry, "InvalidManifestVersion").withArgs(1, 2);
      await registry.connect(recorder).sealCaseManifest(caseRef, 1, h("r1"), 1);
      await expect(registry.connect(recorder).sealCaseManifest(caseRef, 1, h("r1-rewrite"), 1))
        .to.be.revertedWithCustomError(registry, "InvalidManifestVersion").withArgs(2, 1);
    });

    it("rejects zero values and outsiders", async () => {
      const { registry, recorder, outsider } = await networkHelpers.loadFixture(deployFixture);
      await expect(registry.connect(recorder).sealCaseManifest(ZeroHash, 1, h("r"), 1))
        .to.be.revertedWithCustomError(registry, "ZeroValue").withArgs("caseRef");
      await expect(registry.connect(recorder).sealCaseManifest(caseRef, 1, ZeroHash, 1))
        .to.be.revertedWithCustomError(registry, "ZeroValue").withArgs("root");
      await expect(registry.connect(recorder).sealCaseManifest(caseRef, 1, h("r"), 0))
        .to.be.revertedWithCustomError(registry, "EmptyBatch");
      await expect(registry.connect(outsider).sealCaseManifest(caseRef, 1, h("r"), 1))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("case-level audit events (request filed/granted) chain on a sealed case, not on unknown cases", async () => {
      const { registry, recorder } = await networkHelpers.loadFixture(deployFixture);
      await expect(registry.connect(recorder).logAuditEvent(caseRef, Action.RequestFiled, h("actor:advocate"), h("req:1")))
        .to.be.revertedWithCustomError(registry, "SubjectNotFound").withArgs(caseRef);
      await registry.connect(recorder).sealCaseManifest(caseRef, 1, h("r1"), 1);
      await expect(registry.connect(recorder).logAuditEvent(caseRef, Action.RequestFiled, h("actor:advocate"), h("req:1")))
        .to.emit(registry, "AuditEventLogged");
      await registry.connect(recorder).logAuditEvent(caseRef, Action.RequestGranted, h("actor:judge"), h("req:1:grant"));
      expect((await registry.getAuditState(caseRef)).count).to.equal(2n);
    });
  });

  describe("anchorBatch", () => {
    it("anchors once per batchId", async () => {
      const { registry, recorder } = await networkHelpers.loadFixture(deployFixture);
      await expect(registry.connect(recorder).anchorBatch(1, h("root"), h("sig"), 5))
        .to.emit(registry, "BatchAnchored").withArgs(1, h("root"), h("sig"), 5);
      const b = await registry.getBatch(1);
      expect(b.root).to.equal(h("root"));
      expect(b.docCount).to.equal(5n);
      await expect(registry.connect(recorder).anchorBatch(1, h("root2"), h("sig"), 5))
        .to.be.revertedWithCustomError(registry, "BatchAlreadyAnchored").withArgs(1);
    });

    it("rejects zero root, zero signature hash, empty batch, outsiders", async () => {
      const { registry, recorder, outsider } = await networkHelpers.loadFixture(deployFixture);
      await expect(registry.connect(recorder).anchorBatch(2, ZeroHash, h("s"), 1))
        .to.be.revertedWithCustomError(registry, "ZeroValue").withArgs("root");
      await expect(registry.connect(recorder).anchorBatch(2, h("r"), ZeroHash, 1))
        .to.be.revertedWithCustomError(registry, "ZeroValue").withArgs("signatureHash");
      await expect(registry.connect(recorder).anchorBatch(2, h("r"), h("s"), 0))
        .to.be.revertedWithCustomError(registry, "EmptyBatch");
      await expect(registry.connect(outsider).anchorBatch(2, h("r"), h("s"), 1))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("admin controls", () => {
    it("only admin manages profiles; descriptors are immutable once published", async () => {
      const { registry, admin, recorder } = await networkHelpers.loadFixture(deployFixture);
      await expect(registry.connect(recorder).setCryptoProfile(2, h("v2"), true))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await expect(registry.connect(admin).setCryptoProfile(2, h("v2"), true))
        .to.emit(registry, "CryptoProfileSet").withArgs(2, h("v2"), true);
      await expect(registry.connect(admin).setCryptoProfile(1, h("different"), true))
        .to.be.revertedWithCustomError(registry, "ProfileDescriptorImmutable").withArgs(1);
      await expect(registry.connect(admin).setCryptoProfile(0, h("x"), true))
        .to.be.revertedWithCustomError(registry, "UnknownProfile").withArgs(0);
    });

    it("pause blocks every write; only PAUSER can pause/unpause", async () => {
      const { registry, admin, recorder, verifier, outsider, recordId } = await networkHelpers.loadFixture(withRecord);
      await expect(registry.connect(outsider).pause()).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await registry.connect(admin).pause();
      await expect(registry.connect(recorder).registerRecord(h("p2"), recordInput())).to.be.revertedWithCustomError(registry, "EnforcedPause");
      await expect(registry.connect(verifier).attestSignature(recordId, Verdict.Valid, h("e"))).to.be.revertedWithCustomError(registry, "EnforcedPause");
      await expect(registry.connect(recorder).logAuditEvent(recordId, Action.View, h("a"), h("e"))).to.be.revertedWithCustomError(registry, "EnforcedPause");
      await expect(registry.connect(recorder).anchorBatch(9, h("r"), h("s"), 1)).to.be.revertedWithCustomError(registry, "EnforcedPause");
      await registry.connect(admin).unpause();
      await expect(registry.connect(recorder).anchorBatch(9, h("r"), h("s"), 1)).to.emit(registry, "BatchAnchored");
    });

    it("revoked recorder loses access immediately", async () => {
      const { registry, admin, recorder } = await networkHelpers.loadFixture(deployFixture);
      await registry.connect(admin).revokeRole(await registry.RECORDER_ROLE(), recorder.address);
      await expect(registry.connect(recorder).anchorBatch(1, h("r"), h("s"), 1))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("event indexing", () => {
    it("indexes and decodes all events in small block windows", async () => {
      const { registry, recorder, verifier, recordId, deployBlock } = await networkHelpers.loadFixture(withRecord);
      await registry.connect(verifier).attestSignature(recordId, Verdict.Valid, h("e"));
      await registry.connect(recorder).logAuditEvent(recordId, Action.Upload, h("a"), h("ev"));
      await registry.connect(recorder).anchorBatch(1, h("root"), h("sig"), 1);
      const latest = await ethers.provider.getBlockNumber();
      const events = await indexEvents(registry, deployBlock, latest, 2); // tiny window forces chunking
      expect(events.map((e) => e.event)).to.deep.equal([
        "RoleGranted", "RoleGranted", "RoleGranted", "RoleGranted", "CryptoProfileSet",
        "RecordRegistered", "SignatureAttested", "AuditEventLogged", "BatchAnchored",
      ]);
      const reg = events.find((e) => e.event === "RecordRegistered")!;
      expect(reg.args.recordId).to.equal(recordId);
      expect(reg.args.recorder).to.equal(recorder.address);
    });
  });

  it("never stores plaintext: every stored record field is a fixed-size commitment or metadata number", async () => {
    const abi = (await ethers.getContractFactory("SakshyaRegistry")).interface;
    const recordType = abi.getFunction("getRecord")!.outputs[0];
    const kinds = recordType.components!.map((c) => c.type);
    expect(kinds.every((t) => ["bytes32", "address", "uint64", "uint32", "uint16"].includes(t))).to.equal(true);
    expect(kinds).to.not.include("string");
    expect(kinds).to.not.include("bytes");
  });
});
