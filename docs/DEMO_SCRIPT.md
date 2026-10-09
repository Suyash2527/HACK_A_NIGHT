# QuantumShield — three-minute demo

Assumption: five authenticated browser profiles are prepared; Claude provides the seeded fixtures, privileged attack script and on-demand anchoring operation. All records are fictional. Present on the deployed EC2 + CloudFront HTTPS URL.

## Before the clock

- Open P case/upload, F assigned case, R document, J integrity dashboard, and P recovery tabs. No role-switch control that bypasses Cognito. Use the UUIDs/names in UI_SPEC.
- Prepare a 16,384-byte ASCII FIR `.txt`, an assigned forensic PDF, an unassigned-case deep link, and a confirmed pre-anchored FIR fixture. Keep the live upload distinct from the pre-anchored fixture.
- Confirm all six checks pass on the attack fixture and a retained original S3 version exists. Record a short red → restored-green rehearsal; label it “Recorded rehearsal” if used.
- Attack-script contract for Claude, not code: target only the seeded FIR; decrypt in memory, XOR exactly one plaintext byte at offset 9000 with 0x01, re-encrypt with a fresh valid AES-GCM nonce/tag, and overwrite the current S3 object key. S3 versioning creates a new object version; Object Lock retains the old one. Make the current envelope/tag available to the verifier through the isolated demo harness, without rewriting signed hash/chunk hashes/signature/proof/audit history. Do not write plaintext to disk.
- The attacker is deliberately modeled with decryption and re-encryption privileges. If ciphertext alone is flipped or the tag is stale, GCM fails and localization cannot be demonstrated. Rehearse this distinction. No production attack endpoint or UI control.
- Recovery appends a new document version from the locked original; authorized contributor only. Prepare backend anchoring to fit the timing below. Confirmation time cannot be guaranteed; keep the recorded recovery and confirmed fixture ready.
- Bonus assistant: use Bedrock only if access filtering and no-plaintext-persistence work. Otherwise prepare a clearly labelled illustrative answer.

## Click-by-click run (180 seconds, five steps)

| Time | Operator clicks / action | Presenter says / evidence shown |
|---|---|---|
| **0:00–0:15 · 1, preview** | Play a 5-second **Recorded rehearsal** inset: green → red `chunk 2, bytes 8192–12287` → new restored version green. Close it; open P `/cases/[id]`. | “One changed byte can undermine a case. Watch us locate its chunk, identify recent access, and recover a protected original. We will repeat that live.” This previews the step-4 wow moment inside 30 seconds. |
| **0:15–0:40 · 1, police upload** | Click **Upload document** → FIR → select `FIR_0142.txt` → **Upload** → expand receipt. | “Inspector Patil submits evidence. The backend encrypts it, signs its commitment, and records custody.” Point to plaintext SHA-256, AES-256-GCM, ML-KEM wrapping, ML-DSA signature and audit-entry ID. Show pending/unanchored honestly; the file is below 4 MB. |
| **0:40–1:00 · 2, zero trust** | Switch to F profile → navigate to unassigned case deep link → show **Access denied**. Switch J audit tab → latest **DENIED** row. Return F assigned case → **Upload document** → forensic report → submit. | “Lab access is restricted to assigned cases. This denied attempt is recorded. The same lab can submit a report to its assigned investigation.” Show successful receipt. |
| **1:00–1:25 · 3, prosecutor verifies** | Switch R → assigned case → open the **pre-anchored FIR fixture** → IntegrityPanel → six checks → **View on Polygon Amoy** → return. | “This prepared document is fully verified. ML-DSA signatures are checked off-chain by our backend. Polygon stores hashes and the verifier’s attestation; it does not verify the PQ signature itself.” Point to batch ID, confirmed root and real transaction. |
| **1:25–1:45 · 4, insider attack** | Human operator runs Claude's fixture attack script. Switch J `/integrity` → **Run integrity scan** → open red finding. | “An insider with key access decrypts the evidence, changes one plaintext byte, then re-encrypts it with a valid tag and overwrites the current S3 object.” Show decryption pass but content/hash checks fail. “Chunk 2: bytes 8192–12287. The script changed offset 9000; verification independently narrows it to this chunk.” |
| **1:45–2:20 · 4, recovery** | Expand **Last accessors**. Switch P to damaged document → **Restore original (S3 Object Lock)** → enter “Recover retained original after demo integrity incident” → confirm → open new version → verify/refresh after backend anchor confirms. | “These are recent accessors, not proof of guilt. S3 Object Lock retained the original. Restore creates a new signed version and preserves the red incident history.” Show new version's green VERIFIED after confirmed anchoring, then old version still red. If pending, use the honest fallback below. |
| **2:20–3:00 · 5, assistant + close** | Open `/assistant` in R profile → select assigned case → ask **“What does the forensic report conclude about the seized device?”** → expand cited report → point to hash/status; finish on AWS & trust strip. | “The answer retrieves only evidence this prosecutor can access, with verifiable citations. It supports review; it does not decide the case.” Example fictional answer: “The report records a USB device received under seal and a matching acquisition checksum; it does not establish authorship.” Close: “Encrypted evidence, restricted access, detectable changes, recoverable originals—with AWS protecting each layer.” |

## Honest failure cues

- Chain pending after restore: keep amber on the live screen. Say “The restored content checks pass; its new anchor is awaiting confirmation.” Show labelled recorded rehearsal of the final green state. Never call the live recovery fully VERIFIED until the backend does.
- API failure: explicitly open **Demo data — simulated results** or prepared screenshots, name the unavailable dependency, and continue the same clicks. Do not show fabricated explorer transactions.
- Assistant cut: keep step 5, display **Illustrative answer — Bedrock unavailable**, explain citations/access filtering as the intended bonus, and spend remaining seconds on the live custody trail.
- Decryption fails during attack: show the red authentication failure honestly; do not invent a chunk range. Use the labelled rehearsal for the successful re-encryption/localization scenario.
