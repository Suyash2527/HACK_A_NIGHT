# Sakshya — on-chain audit layer (`SakshyaRegistry`)

Polygon is the **audit and coordination layer**. It is not the cryptographic engine. ML-KEM-768, HKDF-SHA-256, AES-256-GCM and ML-DSA-65 all run in the Node.js backend. The chain stores only **commitments**: 32-byte hashes, version numbers and role-holder addresses. It never stores plaintext, keys, signatures or case metadata.

| | |
|---|---|
| Toolchain | Hardhat 3.19 (ESM), ethers v6.17, OpenZeppelin Contracts 5.6, solc 0.8.28 (`evmVersion: paris`) |
| Networks | `hardhatMainnet` (in-process, used by tests), `localhost` (31337), `amoy` (**80002**, POL), `polygon` (137, guarded) |
| Network config | `config/networks.ts`. It has no dependencies; the Next.js backend imports the same file. |

## Trust model: who verifies the ML-DSA-65 signature?

**The blockchain does not verify post-quantum signatures.** There is no ML-DSA precompile, and checking a 3,309-byte ML-DSA-65 signature in the EVM is impractical.

1. **Uploader (off-chain).** The backend signs the canonical document payload with ML-DSA-65. The signature and public key are stored off-chain (RDS).
2. **Recorder (`RECORDER_ROLE`, backend).** `registerRecord` commits `sha256(plaintext)`, the chunk Merkle root, `sha256(signature)`, `sha256(publicKey)`, the crypto profile id and the version lineage. It is write-once per `recordId`.
3. **Verifier (`VERIFIER_ROLE`, off-chain service).** It verifies the ML-DSA-65 signature with `@noble/post-quantum`. It then calls `attestSignature(recordId, Valid|Invalid, evidenceHash)`, where `evidenceHash = sha256(canonical JSON {recordId, alg, signatureHash, publicKeyHash, result, verifiedAt})`. The chain records **who** attested (the verifier address), **what** they concluded, **when**, and **which evidence**. Each verifier gets one immutable verdict per record, and several independent verifiers can attest the same record.
4. **Anyone (independent audit).** Fetch the signature, public key and evidence JSON off-chain. Check that their SHA-256 hashes match the on-chain commitments, then re-run ML-DSA-65 verification yourself. A forged or swapped signature cannot match `signatureHash`.

What an on-chain record therefore proves: *these exact bytes were committed at time T, and verifier V claimed the PQ signature was valid*. It does **not** prove that the signature is valid on its own. That trust rests on the verifier key plus anyone's ability to re-verify. The recorder cannot grade its own records unless an admin deliberately gives the same key both roles; use separate keys outside the demo.

Crypto agility: profile 1 is `sha256("Sakshya/v1;kem=ML-KEM-768(FIPS203);kdf=HKDF-SHA-256;aead=AES-256-GCM;sig=ML-DSA-65(FIPS204);hash=SHA-256;merkle=SHA-256-sorted-pairs,4096B-chunks")`. A profile's descriptor is immutable once published; admins can only deactivate it or add a new id.

## Contract surface

| Function | Role | Guards |
|---|---|---|
| `registerRecord(recordId, RecordInput)` | RECORDER | non-zero hashes, active profile, write-once, parent must exist, `version > parent.version` (originals must be v1) |
| `attestSignature(recordId, verdict, evidenceHash)` | VERIFIER | record exists, verdict ≠ None, one per (record, verifier) |
| `sealCaseManifest(caseRef, version, root, documentCount)` | RECORDER | case "folder" root over all document leaves; versions strictly sequential (folder only grows) |
| `logAuditEvent(subjectId, action, actorHash, eventHash)` | RECORDER | subject = registered record **or** sealed case; valid action enum (15 actions incl. request filed/granted/rejected, folder assembled, milestone, manifest sealed); non-zero hashes; each `eventHash` once (replay protection); updates the subject's keccak hash chain (`getAuditState`). `eventHash` covers the off-chain entry **including its legal basis** |
| `anchorBatch(batchId, root, signatureHash, docCount)` | RECORDER | non-zero, `docCount > 0`, write-once per batch |
| `setCryptoProfile`, `grantRole`/`revokeRole` | ADMIN | descriptor immutable |
| `pause` / `unpause` | PAUSER | all writes blocked while paused |

`actorHash` must be a pseudonym (e.g. `sha256(userId ‖ serverSalt)`), never a name or email. `recordId` should be `sha256("qs:doc:" ‖ uuid)`, not the raw DB id.

Gas, measured from real transactions on a local node:

| Transaction | Gas | ≈ POL at Amoy's observed 120 gwei |
|---|---|---|
| deploy | 1,654,710 | 0.199 |
| `registerRecord` | 173,700 | 0.021 |
| `attestSignature` | 79,186 | 0.010 |
| `logAuditEvent` | 83,223 | 0.010 |
| `anchorBatch` | 96,403 | 0.012 |

Register documents one at a time only for important records, and use `anchorBatch` for bulk integrity. Budget **at least 0.4 test POL** for a deploy plus a demo run.

## Commands

```bash
npm install
npm test                 # 28 tests: contract + network guard
npm run typecheck
npm run node             # local chain on :8545 (separate terminal)
npm run deploy:local && npm run smoke:local && npm run index:local
npm run wallet:new       # fresh testnet-only key -> contracts/.env (prints address only)
npm run preflight:amoy   # read-only: RPC, chainId == 80002, key, balance, deploy cost
npm run deploy:amoy      # real deployment; writes deployments/amoy.{json,md} + ABI
npm run smoke:amoy       # one tx per write path (spends test POL)
npm run index:amoy       # events -> deployments/events-amoy.json
npx hardhat verify --network amoy <address> <constructor args from deployments/amoy.md>
```

Every script runs `guardChain` **before it touches any key**. It refuses mainnet unless `QS_ALLOW_MAINNET=I_UNDERSTAND_REAL_FUNDS` **and** `NODE_ENV=production` are set, and it aborts if the RPC's `eth_chainId` doesn't match the selected network. On remote chains, `preflight` also rejects Hardhat's public dev keys and unfunded deployers.

## RPC notes (checked 2026-10-09)

- The Polygon docs list `https://polygon-amoy.drpc.org` for Amoy and `https://polygon.drpc.org` for mainnet. Both default here, and the Amoy one answered `eth_chainId = 0x13882` live.
- `https://rpc-amoy.polygon.technology` **did not resolve** (DNS failure). Don't use it.
- Free RPCs rate-limit and cap `eth_getLogs` ranges. Use `INDEX_BLOCK_RANGE` for the indexer, and the backend should use `batchMaxCount: 1`.
