// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// Minimal Paymaster interface for MVP
contract Paymaster is Ownable {
    constructor() Ownable(msg.sender) {}

    function validatePaymasterUserOp(
        // UserOperation calldata userOp,
        // bytes32 userOpHash,
        // uint256 maxCost
    )
        external
        pure
        returns (bytes memory context, uint256 validationData)
    {
        // Allow everything for MVP
        return ("", 0);
    }
}
