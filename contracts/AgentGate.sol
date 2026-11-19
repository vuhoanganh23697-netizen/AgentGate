// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title AgentGate
 * @notice Open-Web Pre-Sign Privilege Firewall & Non-Transferable Identity Research Registry.
 * @dev Built for AI Agent Wallets (chat/MCP/CLI) and open-web stateless verification on Chain 56.
 *      Eligibility is checked via balanceOf(msg.sender) > 0 on the non-transferable ERC-721 registry.
 *
 *      Disclosed Permissions & Safety Invariants (100% Pure-Data Nonpayable Contract):
 *      - ZERO payable functions, ZERO receive(), ZERO fallback(), ZERO native value transfers,
 *        ZERO deposit vaults, and ZERO ERC-20 token approvals. Any call sent with msg.value > 0
 *        reverts automatically at the EVM dispatcher level.
 *      - Any ERC-20 tokens mistakenly transferred directly to this contract address cannot be
 *        recovered because no admin sweep or withdrawal function exists.
 *      - Exposes NO mint, NO tax, NO pause, NO freeze, NO blacklist, and NO proxy upgrade.
 *      - editorialPublisher is immutable and holds zero financial privileges: it can only anchor
 *        canonical SHA-256 editorial research hashes.
 *      - Anti-farming & anti-wash-volume protections:
 *        * 1 unlock per (wallet, anchored reportHash) ever.
 *        * Pre-sign audit target must have deployed contract bytecode (code.length > 0), capped at
 *          1 receipt per (wallet, targetContract) and max 5 receipts per wallet per UTC day.
 *        * 1 nomination vote per wallet per UTC day (target must have deployed bytecode).
 *        * 1 community research hash anchor per wallet per UTC day (target must have bytecode).
 *      - Never resolves, stores, or indexes personal .ai handle-to-wallet mappings on-chain.
 */

interface IERC721BalanceRead {
    function balanceOf(address owner) external view returns (uint256);
}

contract AgentGate {
    /// @notice Official non-transferable SPACE ID Agent ID ERC-721 contract on Chain 56.
    address public constant AGENT_ID_REGISTRY = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    /// @notice Anti-spam daily cap on pre-sign receipts per Agent ID wallet per UTC day.
    uint8 public constant MAX_DAILY_CHECKS_PER_USER = 5;

    /// @notice Size of the on-chain ring buffer for recent Pre-Sign Firewall receipts (single eth_call read).
    uint256 public constant RECEIPT_RING_SIZE = 20;

    /// @notice Editorial desk address set once at deployment (only anchors desk SHA-256 hashes; holds zero financial privileges).
    address public immutable editorialPublisher;

    /// @notice Canonical SHA-256 hash of the Genesis Sovereign Editorial Method Note anchored at deploy.
    bytes32 public immutable genesisReportHash;

    struct ReportAnchor {
        address author;
        address subjectContract;
        uint64 anchoredAt;
        uint32 uniqueReaders;
        bool exists;
    }

    struct ReceiptSlot {
        address reader;
        address subjectContract;
        uint64 recordedAt;
        uint8 triggeredFlags;
    }

    uint256 public uniqueAgentIdUsers;
    uint256 public totalReportUnlocks;
    uint256 public totalPreSignReceipts;
    uint256 public totalVotesCast;
    uint256 public totalReportsAnchored;
    uint256 public receiptRingTotal;

    ReceiptSlot[20] private _recentReceipts;

    mapping(address => bool) public hasEverInteracted;
    mapping(bytes32 => ReportAnchor) public reports;
    mapping(bytes32 => mapping(address => uint64)) public reportUnlockedAt;
    mapping(address => mapping(address => bool)) public hasCheckedContract;
    mapping(address => mapping(uint64 => uint8)) public dailyCheckCount;
    mapping(address => uint64) public lastVoteUtcDay;
    mapping(address => uint64) public lastCommunityAnchorUtcDay;
    mapping(uint64 => mapping(address => uint256)) public dailyCandidateVotes;
    mapping(address => uint256) public totalCandidateVotes;

    event ReportAnchored(
        bytes32 indexed reportHash,
        address indexed author,
        address indexed subjectContract,
        uint64 anchoredAt
    );

    event PreSignReportUnlocked(
        address indexed reader,
        bytes32 indexed reportHash,
        uint32 readerOrdinal,
        uint64 unlockedAt
    );

    event PreSignAuditRecorded(
        address indexed reader,
        address indexed subjectContract,
        bytes32 indexed reportHash,
        uint8 triggeredFlags,
        uint64 utcDay,
        string note
    );

    event AuditTargetNominated(
        address indexed voter,
        address indexed candidateContract,
        uint64 indexed utcDay,
        uint256 newDailyCount
    );

    modifier onlyAgentIdHolder() {
        require(
            IERC721BalanceRead(AGENT_ID_REGISTRY).balanceOf(msg.sender) > 0,
            "AgentGate: caller wallet holds 0 SPACE ID Agent IDs"
        );
        _;
    }

    /**
     * @notice Zero-argument nonpayable constructor for 1-click Remix deployment & BscScan single-file verification.
     *         Pre-anchors the canonical Genesis Sovereign Editorial essay hash to the deployer wallet.
     */
    constructor() {
        editorialPublisher = msg.sender;
        bytes32 genesis = 0x08dd1b7400c26066f15693694f4b362c1403d305e773297814eb1ff172917df3;
        genesisReportHash = genesis;
        uint64 nowTs = uint64(block.timestamp);
        address genesisSubject = 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82;
        reports[genesis] = ReportAnchor({
            author: msg.sender,
            subjectContract: genesisSubject,
            anchoredAt: nowTs,
            uniqueReaders: 0,
            exists: true
        });
        totalReportsAnchored = 1;
        emit ReportAnchored(genesis, msg.sender, genesisSubject, nowTs);
    }

    function _touchAgentUser(address user) internal {
        if (!hasEverInteracted[user]) {
            hasEverInteracted[user] = true;
            unchecked {
                uniqueAgentIdUsers += 1;
            }
        }
    }

    function _pushReceiptSlot(address reader, address subjectContract, uint8 triggeredFlags) internal {
        uint256 idx = receiptRingTotal % RECEIPT_RING_SIZE;
        _recentReceipts[idx] = ReceiptSlot({
            reader: reader,
            subjectContract: subjectContract,
            recordedAt: uint64(block.timestamp),
            triggeredFlags: triggeredFlags
        });
        unchecked {
            receiptRingTotal += 1;
            totalPreSignReceipts += 1;
        }
    }

    function _unlockInternal(address reader, bytes32 reportHash) internal {
        require(reportHash != bytes32(0), "AgentGate: zero reportHash");
        require(reports[reportHash].exists, "AgentGate: unknown unanchored reportHash");
        require(
            reportUnlockedAt[reportHash][reader] == 0,
            "AgentGate: report already unlocked by this Agent ID"
        );

        _touchAgentUser(reader);
        uint64 nowTs = uint64(block.timestamp);
        reportUnlockedAt[reportHash][reader] = nowTs;

        ReportAnchor storage r = reports[reportHash];
        unchecked {
            r.uniqueReaders += 1;
            totalReportUnlocks += 1;
        }

        emit PreSignReportUnlocked(reader, reportHash, r.uniqueReaders, nowTs);
    }

    function _enforceTargetAndQuota(address reader, address subjectContract) internal returns (uint64 utcDay) {
        require(subjectContract != address(0), "AgentGate: zero target contract");
        require(
            subjectContract.code.length > 0,
            "AgentGate: target address has no deployed contract bytecode"
        );
        require(
            !hasCheckedContract[reader][subjectContract],
            "AgentGate: pre-sign receipt already logged for this contract"
        );
        utcDay = uint64(block.timestamp / 1 days);
        uint8 usedToday = dailyCheckCount[reader][utcDay];
        require(
            usedToday < MAX_DAILY_CHECKS_PER_USER,
            "AgentGate: daily pre-sign receipt cap (5/day) reached"
        );
        hasCheckedContract[reader][subjectContract] = true;
        unchecked {
            dailyCheckCount[reader][utcDay] = usedToday + 1;
        }
    }

    /**
     * @notice Zero-argument nonpayable unlock of the Genesis Sovereign Editorial Method Note.
     *         Designed for natural-language AI Agent prompts with zero hex-parameter friction.
     */
    function unlockGenesisReport() external onlyAgentIdHolder {
        _unlockInternal(msg.sender, genesisReportHash);
    }

    /**
     * @notice Nonpayable 0-fee unlock for any anchored SHA-256 reportHash.
     *         Strictly max 1 unlock per (reader, reportHash) to prevent artificial tx farming.
     */
    function unlockReport(bytes32 reportHash) external onlyAgentIdHolder {
        _unlockInternal(msg.sender, reportHash);
    }

    /**
     * @notice Agentic Pre-Sign Firewall Receipt: AI Agent inspects a real deployed contract's 8
     *         privilege flags first, counts triggeredFlags (0..8), writes a short factual summary
     *         (<= 140 bytes), and logs a public on-chain safety receipt (max 1 per wallet+contract,
     *         max 5 per UTC day). Also unlocks the Genesis Method Note if not yet unlocked.
     */
    function recordPreSignAudit(
        address subjectContract,
        uint8 triggeredFlags,
        string calldata note
    ) external onlyAgentIdHolder {
        require(triggeredFlags <= 8, "AgentGate: triggeredFlags must be 0..8");
        require(bytes(note).length <= 140, "AgentGate: note exceeds 140 bytes");

        uint64 utcDay = _enforceTargetAndQuota(msg.sender, subjectContract);
        _touchAgentUser(msg.sender);
        _pushReceiptSlot(msg.sender, subjectContract, triggeredFlags);

        bytes32 genesis = genesisReportHash;
        if (reportUnlockedAt[genesis][msg.sender] == 0) {
            uint64 nowTs = uint64(block.timestamp);
            reportUnlockedAt[genesis][msg.sender] = nowTs;
            ReportAnchor storage r = reports[genesis];
            unchecked {
                r.uniqueReaders += 1;
                totalReportUnlocks += 1;
            }
            emit PreSignReportUnlocked(msg.sender, genesis, r.uniqueReaders, nowTs);
        }

        emit PreSignAuditRecorded(msg.sender, subjectContract, genesis, triggeredFlags, utcDay, note);
    }

    /**
     * @notice CLI / MCP nonpayable pre-sign check receipt tied to a specific anchored reportHash.
     */
    function logPreSignCheck(address subjectContract, bytes32 reportHash) external onlyAgentIdHolder {
        require(reportHash != bytes32(0), "AgentGate: zero reportHash");
        require(reports[reportHash].exists, "AgentGate: unknown unanchored reportHash");

        uint64 utcDay = _enforceTargetAndQuota(msg.sender, subjectContract);
        _touchAgentUser(msg.sender);
        _pushReceiptSlot(msg.sender, subjectContract, 255);

        if (reportUnlockedAt[reportHash][msg.sender] == 0) {
            uint64 nowTs = uint64(block.timestamp);
            reportUnlockedAt[reportHash][msg.sender] = nowTs;
            ReportAnchor storage r = reports[reportHash];
            unchecked {
                r.uniqueReaders += 1;
                totalReportUnlocks += 1;
            }
            emit PreSignReportUnlocked(msg.sender, reportHash, r.uniqueReaders, nowTs);
        }

        emit PreSignAuditRecorded(msg.sender, subjectContract, reportHash, 255, utcDay, "");
    }

    /**
     * @notice Sybil-resistant daily ballot: 1 Agent ID = 1 Vote per UTC day for a deployed contract.
     */
    function voteNextAudit(address candidateContract) external onlyAgentIdHolder {
        require(candidateContract != address(0), "AgentGate: zero candidate contract");
        require(
            candidateContract.code.length > 0,
            "AgentGate: candidate address has no deployed contract bytecode"
        );

        uint64 utcDay = uint64(block.timestamp / 1 days);
        require(lastVoteUtcDay[msg.sender] != utcDay, "AgentGate: already voted today (UTC day)");

        _touchAgentUser(msg.sender);
        lastVoteUtcDay[msg.sender] = utcDay;

        uint256 newDaily;
        unchecked {
            newDaily = dailyCandidateVotes[utcDay][candidateContract] + 1;
            dailyCandidateVotes[utcDay][candidateContract] = newDaily;
            totalCandidateVotes[candidateContract] += 1;
            totalVotesCast += 1;
        }

        emit AuditTargetNominated(msg.sender, candidateContract, utcDay, newDaily);
    }

    /**
     * @notice Anchor a new canonical SHA-256 editorial research note from the editorial desk.
     */
    function anchorEditorialReport(bytes32 reportHash, address subjectContract) external {
        require(msg.sender == editorialPublisher, "AgentGate: caller is not editorialPublisher");
        _anchor(reportHash, msg.sender, subjectContract);
    }

    /**
     * @notice Allow any verified Agent ID researcher to anchor at most 1 SHA-256 security note per UTC day.
     */
    function anchorCommunityReport(bytes32 reportHash, address subjectContract) external onlyAgentIdHolder {
        uint64 utcDay = uint64(block.timestamp / 1 days);
        require(
            lastCommunityAnchorUtcDay[msg.sender] != utcDay,
            "AgentGate: community anchor capped at 1 per UTC day"
        );
        lastCommunityAnchorUtcDay[msg.sender] = utcDay;
        _touchAgentUser(msg.sender);
        _anchor(reportHash, msg.sender, subjectContract);
    }

    function _anchor(bytes32 reportHash, address author, address subjectContract) internal {
        require(reportHash != bytes32(0), "AgentGate: zero reportHash");
        require(subjectContract != address(0), "AgentGate: zero subjectContract");
        require(
            subjectContract.code.length > 0,
            "AgentGate: subjectContract has no deployed bytecode"
        );
        require(!reports[reportHash].exists, "AgentGate: reportHash already anchored");

        uint64 nowTs = uint64(block.timestamp);
        reports[reportHash] = ReportAnchor({
            author: author,
            subjectContract: subjectContract,
            anchoredAt: nowTs,
            uniqueReaders: 0,
            exists: true
        });
        unchecked {
            totalReportsAnchored += 1;
        }

        emit ReportAnchored(reportHash, author, subjectContract, nowTs);
    }

    // --- Read-Only Batch Views for Stateless Open Web & Vercel Serverless ---

    function hasUnlockedGenesis(address reader) external view returns (bool) {
        return reportUnlockedAt[genesisReportHash][reader] != 0;
    }

    function hasUnlockedReport(bytes32 reportHash, address reader) external view returns (bool) {
        return reportUnlockedAt[reportHash][reader] != 0;
    }

    function checkHoldsAgentId(address wallet) public view returns (bool) {
        if (wallet == address(0)) return false;
        return IERC721BalanceRead(AGENT_ID_REGISTRY).balanceOf(wallet) > 0;
    }

    function getProtocolStats(bytes32 reportHash)
        external
        view
        returns (
            uint256 _uniqueAgentIdUsers,
            uint256 _totalPreSignReceipts,
            uint256 _totalVotesCast,
            uint256 _totalReportsAnchored,
            uint32 _reportUniqueReaders,
            address _editorialPublisher,
            address _registry
        )
    {
        bytes32 targetHash = reportHash == bytes32(0) ? genesisReportHash : reportHash;
        return (
            uniqueAgentIdUsers,
            totalPreSignReceipts,
            totalVotesCast,
            totalReportsAnchored,
            reports[targetHash].uniqueReaders,
            editorialPublisher,
            AGENT_ID_REGISTRY
        );
    }

    function getBallotTallies(address[4] calldata candidates)
        external
        view
        returns (uint64 currentUtcDay, uint256[4] memory todayCounts, uint256[4] memory allTimeCounts)
    {
        currentUtcDay = uint64(block.timestamp / 1 days);
        for (uint256 i = 0; i < 4; i++) {
            todayCounts[i] = dailyCandidateVotes[currentUtcDay][candidates[i]];
            allTimeCounts[i] = totalCandidateVotes[candidates[i]];
        }
    }

    function getRecentReceipts()
        external
        view
        returns (
            address[20] memory readers,
            address[20] memory targets,
            uint64[20] memory timestamps,
            uint8[20] memory flagCounts,
            uint256 totalRecorded
        )
    {
        totalRecorded = receiptRingTotal;
        uint256 count = totalRecorded < RECEIPT_RING_SIZE ? totalRecorded : RECEIPT_RING_SIZE;
        for (uint256 i = 0; i < count; i++) {
            uint256 ringIdx = (totalRecorded - 1 - i) % RECEIPT_RING_SIZE;
            ReceiptSlot storage slot = _recentReceipts[ringIdx];
            readers[i] = slot.reader;
            targets[i] = slot.subjectContract;
            timestamps[i] = slot.recordedAt;
            flagCounts[i] = slot.triggeredFlags;
        }
    }
}
