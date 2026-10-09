// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title SakshyaRegistry
/// @notice Public audit + coordination layer for Sakshya. It stores ONLY commitments:
///         SHA-256 hashes of documents, chunk Merkle roots, ML-DSA-65 signature/public-key hashes,
///         pseudonymous actor hashes and Merkle batch roots. Never plaintext, keys or case metadata.
/// @dev TRUST MODEL — this contract does NOT verify ML-DSA-65 (post-quantum) signatures. There is no
///      precompile for it and on-chain verification of a 3,309-byte signature is impractical.
///      Verification happens OFF-CHAIN in the Node.js backend; an account holding VERIFIER_ROLE then
///      records its verdict plus an evidence hash via {attestSignature}. Anyone holding the off-chain
///      signature, public key and evidence JSON can re-verify independently and check them against the
///      hashes committed here. See contracts/README.md "Trust model".
contract SakshyaRegistry is AccessControl, Pausable {
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE"); // backend: records, audit events, batches
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE"); // off-chain ML-DSA verifier service
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum Verdict {
        None,
        Valid,
        Invalid
    }

    /// @dev Mirrors the app's audit actions. Append new values only at the end.
    enum AuditAction {
        Upload,
        View,
        Download,
        Verify,
        Denied,
        Anchor,
        Scan,
        TamperDetected,
        Restore,
        RequestFiled,
        RequestGranted,
        RequestRejected,
        FolderAssembled,
        MilestoneAdded,
        ManifestSealed
    }

    struct CryptoProfile {
        bytes32 descriptorHash; // sha256 of the human-readable algorithm descriptor
        bool active;
    }

    struct RecordInput {
        bytes32 documentHash; // SHA-256 of plaintext
        bytes32 chunkRoot; // Merkle root of 4 KiB chunk hashes
        bytes32 signatureHash; // SHA-256 of the uploader's ML-DSA-65 signature bytes (signature kept off-chain)
        bytes32 signerKeyHash; // SHA-256 of the uploader's ML-DSA-65 public key
        bytes32 parentRecordId; // 0x0 for an original; previous version's recordId for a correction
        uint32 version; // 1 for originals; strictly greater than the parent's version otherwise
        uint16 profileId; // crypto profile in force when the document was sealed
    }

    struct Record {
        bytes32 documentHash;
        bytes32 chunkRoot;
        bytes32 signatureHash;
        bytes32 signerKeyHash;
        bytes32 parentRecordId;
        address recorder;
        uint64 registeredAt;
        uint32 version;
        uint16 profileId;
    }

    /// @dev A case "folder": Merkle root over every document leaf in the case at a given version.
    struct CaseManifest {
        bytes32 root;
        uint32 version;
        uint32 documentCount;
        uint64 sealedAt;
    }

    /// @dev keccak hash chain over the audit events of one subject (a document record or a sealed case).
    struct AuditState {
        bytes32 head;
        uint32 count;
    }

    struct Attestation {
        Verdict verdict;
        uint64 verifiedAt;
        uint16 profileId;
        bytes32 evidenceHash; // sha256 of canonical JSON evidence produced by the off-chain verifier
    }

    struct Batch {
        bytes32 root; // Merkle root over document leaves
        bytes32 signatureHash; // sha256 of the system ML-DSA-65 signature over the batch payload
        uint64 anchoredAt;
        uint32 docCount;
    }

    mapping(uint16 => CryptoProfile) private _profiles;
    mapping(bytes32 => Record) private _records;
    mapping(bytes32 => mapping(address => Attestation)) private _attestations;
    mapping(bytes32 => bool) private _usedAuditEvents;
    mapping(uint256 => Batch) private _batches;
    mapping(bytes32 => CaseManifest) private _latestManifest;
    mapping(bytes32 => mapping(uint32 => bytes32)) private _manifestRoots;
    mapping(bytes32 => AuditState) private _audit;

    event CryptoProfileSet(uint16 indexed profileId, bytes32 descriptorHash, bool active);
    event RecordRegistered(
        bytes32 indexed recordId,
        bytes32 indexed documentHash,
        bytes32 indexed parentRecordId,
        uint16 profileId,
        uint32 version,
        bytes32 chunkRoot,
        bytes32 signatureHash,
        bytes32 signerKeyHash,
        address recorder
    );
    event SignatureAttested(
        bytes32 indexed recordId,
        address indexed verifier,
        Verdict verdict,
        uint16 profileId,
        bytes32 evidenceHash
    );
    event CaseManifestSealed(bytes32 indexed caseRef, uint32 indexed version, bytes32 root, uint32 documentCount);
    event AuditEventLogged(
        bytes32 indexed subjectId,
        AuditAction indexed action,
        bytes32 indexed actorHash,
        bytes32 eventHash,
        bytes32 newAuditHead,
        uint32 sequence,
        uint64 timestamp
    );
    event BatchAnchored(uint256 indexed batchId, bytes32 indexed root, bytes32 signatureHash, uint32 docCount);

    error ZeroValue(string field);
    error ZeroAddress();
    error UnknownProfile(uint16 profileId);
    error InactiveProfile(uint16 profileId);
    error ProfileDescriptorImmutable(uint16 profileId);
    error RecordAlreadyRegistered(bytes32 recordId);
    error RecordNotFound(bytes32 recordId);
    error InvalidVersion(uint32 version, uint32 parentVersion);
    error AlreadyAttested(bytes32 recordId, address verifier);
    error InvalidVerdict();
    error InvalidAction(uint8 action);
    error AuditEventReplayed(bytes32 eventHash);
    error BatchAlreadyAnchored(uint256 batchId);
    error EmptyBatch();
    error InvalidManifestVersion(uint32 expected, uint32 provided);
    error SubjectNotFound(bytes32 subjectId);

    /// @param admin     receives DEFAULT_ADMIN_ROLE and PAUSER_ROLE (should be a separate key from the backend)
    /// @param recorder  backend signer allowed to register records, log audit events and anchor batches
    /// @param verifier  off-chain ML-DSA verifier service account
    /// @param initialProfileDescriptorHash sha256 of the v1 crypto profile descriptor (profile id 1)
    constructor(address admin, address recorder, address verifier, bytes32 initialProfileDescriptorHash) {
        if (admin == address(0) || recorder == address(0) || verifier == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(RECORDER_ROLE, recorder);
        _grantRole(VERIFIER_ROLE, verifier);
        _setProfile(1, initialProfileDescriptorHash, true);
    }

    // ------------------------------------------------------------------ admin

    function setCryptoProfile(uint16 profileId, bytes32 descriptorHash, bool active)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setProfile(profileId, descriptorHash, active);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ------------------------------------------------------------------ writes

    /// @notice Seals a document version on-chain. Write-once per recordId.
    /// @param recordId opaque identifier, e.g. sha256("qs:doc:" || documentUuid) — not the raw DB id.
    function registerRecord(bytes32 recordId, RecordInput calldata input)
        external
        onlyRole(RECORDER_ROLE)
        whenNotPaused
    {
        if (recordId == bytes32(0)) revert ZeroValue("recordId");
        if (input.documentHash == bytes32(0)) revert ZeroValue("documentHash");
        if (input.chunkRoot == bytes32(0)) revert ZeroValue("chunkRoot");
        if (input.signatureHash == bytes32(0)) revert ZeroValue("signatureHash");
        if (input.signerKeyHash == bytes32(0)) revert ZeroValue("signerKeyHash");
        if (_records[recordId].registeredAt != 0) revert RecordAlreadyRegistered(recordId);
        _requireActiveProfile(input.profileId);

        if (input.parentRecordId == bytes32(0)) {
            if (input.version != 1) revert InvalidVersion(input.version, 0);
        } else {
            Record storage parent = _records[input.parentRecordId];
            if (parent.registeredAt == 0) revert RecordNotFound(input.parentRecordId);
            if (input.version <= parent.version) revert InvalidVersion(input.version, parent.version);
        }

        Record storage r = _records[recordId];
        r.documentHash = input.documentHash;
        r.chunkRoot = input.chunkRoot;
        r.signatureHash = input.signatureHash;
        r.signerKeyHash = input.signerKeyHash;
        r.parentRecordId = input.parentRecordId;
        r.recorder = msg.sender;
        r.registeredAt = uint64(block.timestamp);
        r.version = input.version;
        r.profileId = input.profileId;

        emit RecordRegistered(
            recordId,
            input.documentHash,
            input.parentRecordId,
            input.profileId,
            input.version,
            input.chunkRoot,
            input.signatureHash,
            input.signerKeyHash,
            msg.sender
        );
    }

    /// @notice Records the OFF-CHAIN ML-DSA-65 verification verdict of the calling verifier.
    ///         One attestation per (record, verifier); a verifier cannot change its verdict.
    function attestSignature(bytes32 recordId, Verdict verdict, bytes32 evidenceHash)
        external
        onlyRole(VERIFIER_ROLE)
        whenNotPaused
    {
        if (verdict == Verdict.None) revert InvalidVerdict();
        if (evidenceHash == bytes32(0)) revert ZeroValue("evidenceHash");
        Record storage r = _requireRecord(recordId);
        Attestation storage a = _attestations[recordId][msg.sender];
        if (a.verdict != Verdict.None) revert AlreadyAttested(recordId, msg.sender);

        a.verdict = verdict;
        a.verifiedAt = uint64(block.timestamp);
        a.profileId = r.profileId;
        a.evidenceHash = evidenceHash;
        emit SignatureAttested(recordId, msg.sender, verdict, r.profileId, evidenceHash);
    }

    /// @notice Seals a new version of a case folder: the Merkle root over every document leaf in the case.
    ///         Versions are strictly sequential (1, 2, 3, ...) so a folder can only grow, never be rewritten.
    /// @param caseRef opaque case identifier, e.g. sha256("qs:case:" || caseUuid) — never the FIR number.
    function sealCaseManifest(bytes32 caseRef, uint32 version, bytes32 root, uint32 documentCount)
        external
        onlyRole(RECORDER_ROLE)
        whenNotPaused
    {
        if (caseRef == bytes32(0)) revert ZeroValue("caseRef");
        if (root == bytes32(0)) revert ZeroValue("root");
        if (documentCount == 0) revert EmptyBatch();
        uint32 expected = _latestManifest[caseRef].version + 1;
        if (version != expected) revert InvalidManifestVersion(expected, version);

        _latestManifest[caseRef] = CaseManifest(root, version, documentCount, uint64(block.timestamp));
        _manifestRoots[caseRef][version] = root;
        emit CaseManifestSealed(caseRef, version, root, documentCount);
    }

    /// @notice Appends an audit event to the subject's on-chain hash chain.
    /// @param subjectId a registered document recordId OR a caseRef with at least one sealed manifest
    ///        (case-level events: document requests, decisions, milestones, folder assembly).
    /// @param actorHash pseudonymous actor commitment, e.g. sha256(userId || serverSalt) — never a name/email.
    /// @param eventHash sha256 of the off-chain audit_log entry (its entry_hash, which includes the legal
    ///        basis); each may be logged once.
    function logAuditEvent(bytes32 subjectId, uint8 action, bytes32 actorHash, bytes32 eventHash)
        external
        onlyRole(RECORDER_ROLE)
        whenNotPaused
    {
        if (action > uint8(type(AuditAction).max)) revert InvalidAction(action);
        if (actorHash == bytes32(0)) revert ZeroValue("actorHash");
        if (eventHash == bytes32(0)) revert ZeroValue("eventHash");
        if (_usedAuditEvents[eventHash]) revert AuditEventReplayed(eventHash);
        if (_records[subjectId].registeredAt == 0 && _latestManifest[subjectId].version == 0) {
            revert SubjectNotFound(subjectId);
        }

        _usedAuditEvents[eventHash] = true;
        AuditState storage s = _audit[subjectId];
        uint32 sequence = s.count + 1;
        uint64 ts = uint64(block.timestamp);
        bytes32 head = keccak256(abi.encode(s.head, subjectId, sequence, action, actorHash, eventHash, ts));
        s.head = head;
        s.count = sequence;
        emit AuditEventLogged(subjectId, AuditAction(action), actorHash, eventHash, head, sequence, ts);
    }

    /// @notice Anchors a Merkle batch root covering many documents (cheap bulk integrity).
    function anchorBatch(uint256 batchId, bytes32 root, bytes32 signatureHash, uint32 docCount)
        external
        onlyRole(RECORDER_ROLE)
        whenNotPaused
    {
        if (root == bytes32(0)) revert ZeroValue("root");
        if (signatureHash == bytes32(0)) revert ZeroValue("signatureHash");
        if (docCount == 0) revert EmptyBatch();
        if (_batches[batchId].anchoredAt != 0) revert BatchAlreadyAnchored(batchId);
        _batches[batchId] = Batch(root, signatureHash, uint64(block.timestamp), docCount);
        emit BatchAnchored(batchId, root, signatureHash, docCount);
    }

    // ------------------------------------------------------------------ reads

    function getRecord(bytes32 recordId) external view returns (Record memory) {
        return _records[recordId];
    }

    function isRegistered(bytes32 recordId) external view returns (bool) {
        return _records[recordId].registeredAt != 0;
    }

    function getAttestation(bytes32 recordId, address verifier) external view returns (Attestation memory) {
        return _attestations[recordId][verifier];
    }

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    function getCryptoProfile(uint16 profileId) external view returns (CryptoProfile memory) {
        return _profiles[profileId];
    }

    function isAuditEventLogged(bytes32 eventHash) external view returns (bool) {
        return _usedAuditEvents[eventHash];
    }

    function getAuditState(bytes32 subjectId) external view returns (AuditState memory) {
        return _audit[subjectId];
    }

    function getCaseManifest(bytes32 caseRef) external view returns (CaseManifest memory) {
        return _latestManifest[caseRef];
    }

    function getManifestRoot(bytes32 caseRef, uint32 version) external view returns (bytes32) {
        return _manifestRoots[caseRef][version];
    }

    // ------------------------------------------------------------------ internal

    function _setProfile(uint16 profileId, bytes32 descriptorHash, bool active) private {
        if (profileId == 0) revert UnknownProfile(0);
        if (descriptorHash == bytes32(0)) revert ZeroValue("descriptorHash");
        bytes32 existing = _profiles[profileId].descriptorHash;
        // A profile's algorithm set is immutable once published; only (de)activation is allowed,
        // so records sealed under it can never be silently reinterpreted.
        if (existing != bytes32(0) && existing != descriptorHash) revert ProfileDescriptorImmutable(profileId);
        _profiles[profileId] = CryptoProfile(descriptorHash, active);
        emit CryptoProfileSet(profileId, descriptorHash, active);
    }

    function _requireActiveProfile(uint16 profileId) private view {
        CryptoProfile storage p = _profiles[profileId];
        if (p.descriptorHash == bytes32(0)) revert UnknownProfile(profileId);
        if (!p.active) revert InactiveProfile(profileId);
    }

    function _requireRecord(bytes32 recordId) private view returns (Record storage r) {
        r = _records[recordId];
        if (r.registeredAt == 0) revert RecordNotFound(recordId);
    }
}
