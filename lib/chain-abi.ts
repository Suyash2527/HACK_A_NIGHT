// Human-readable ABI for SakshyaRegistry (only the functions the backend calls). Source of truth: contracts/contracts/SakshyaRegistry.sol
export const REGISTRY_ABI = [
  "function registerRecord(bytes32 recordId, (bytes32 documentHash, bytes32 chunkRoot, bytes32 signatureHash, bytes32 signerKeyHash, bytes32 parentRecordId, uint32 version, uint16 profileId) input)",
  "function attestSignature(bytes32 recordId, uint8 verdict, bytes32 evidenceHash)",
  "function logAuditEvent(bytes32 subjectId, uint8 action, bytes32 actorHash, bytes32 eventHash)",
  "function sealCaseManifest(bytes32 caseRef, uint32 version, bytes32 root, uint32 documentCount)",
  "function anchorBatch(uint256 batchId, bytes32 root, bytes32 signatureHash, uint32 docCount)",
  "function isRegistered(bytes32 recordId) view returns (bool)",
  "function getCaseManifest(bytes32 caseRef) view returns ((bytes32 root, uint32 version, uint32 documentCount, uint64 sealedAt))",
  "function getBatch(uint256 batchId) view returns ((bytes32 root, bytes32 signatureHash, uint64 anchoredAt, uint32 docCount))",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function RECORDER_ROLE() view returns (bytes32)",
  "function VERIFIER_ROLE() view returns (bytes32)",
  "event RecordRegistered(bytes32 indexed recordId, bytes32 indexed documentHash, bytes32 indexed parentRecordId, uint16 profileId, uint32 version, bytes32 chunkRoot, bytes32 signatureHash, bytes32 signerKeyHash, address recorder)",
  "event SignatureAttested(bytes32 indexed recordId, address indexed verifier, uint8 verdict, uint16 profileId, bytes32 evidenceHash)",
  "event CaseManifestSealed(bytes32 indexed caseRef, uint32 indexed version, bytes32 root, uint32 documentCount)",
] as const;
