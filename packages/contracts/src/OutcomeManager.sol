// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CallRegistry} from "./CallRegistry.sol";

contract OutcomeManager is EIP712, Ownable {
    using ECDSA for bytes32;

    CallRegistry public registry;

    bytes32 public constant OUTCOME_TYPEHASH =
        keccak256("Outcome(uint256 callId,bool outcome,uint256 finalPrice,uint256 timestamp)");
    mapping(address => bool) public authorizedOracle;
    mapping(uint256 => bool) public settled;

    event OutcomeSubmitted(uint256 indexed callId, bool outcome, uint256 finalPrice, address oracle);
    event PayoutWithdrawn(uint256 indexed callId, address indexed recipient, uint256 amount);

    constructor(address _registry) EIP712("OnChainSageOutcome", "1") Ownable(msg.sender) {
        registry = CallRegistry(_registry);
    }

    function setOracle(address _oracle, bool _status) external onlyOwner {
        authorizedOracle[_oracle] = _status;
    }

    function submitOutcome(
        uint256 callId,
        bool outcome,
        uint256 finalPrice,
        uint256 _timestamp,
        bytes calldata signature
    ) external {
        require(!settled[callId], "Already settled");

        // Verify call exists and ended
        (,,,,, uint256 endTs,,,, bool isSettled,,) = registry.calls(callId);
        require(endTs > 0, "Call not found");
        require(block.timestamp >= endTs, "Call not ended");
        require(!isSettled, "Registry says settled");

        bytes32 structHash;
        bytes32 typeHash = OUTCOME_TYPEHASH;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), callId)
            mstore(add(ptr, 0x40), outcome)
            mstore(add(ptr, 0x60), finalPrice)
            mstore(add(ptr, 0x80), _timestamp)
            structHash := keccak256(ptr, 0xa0)
        }
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);

        require(authorizedOracle[signer], "Invalid oracle");

        settled[callId] = true;
        // In a real implementation, we would call back to Registry to update state
        // For this MVP, we track settlement here and allow withdrawals based on this state

        emit OutcomeSubmitted(callId, outcome, finalPrice, signer);
    }

    // Placeholder for withdrawal logic
    // In a full implementation, this would calculate shares and transfer tokens
    function withdrawPayout(uint256 callId) external view {
        require(settled[callId], "Not settled");
        // Implementation details omitted for brevity
    }
}
