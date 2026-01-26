// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Paymaster} from "../src/Paymaster.sol";
import {MockToken} from "../src/MockToken.sol";
import {CallRegistry} from "../src/CallRegistry.sol";
import {OutcomeManager} from "../src/OutcomeManager.sol";
import {Script, console} from "forge-std/Script.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        CallRegistry registry = new CallRegistry();
        OutcomeManager outcomeManager = new OutcomeManager(address(registry));
        Paymaster paymaster = new Paymaster();
        MockToken mockToken = new MockToken();

        console.log("CallRegistry deployed at:", address(registry));
        console.log("OutcomeManager deployed at:", address(outcomeManager));
        console.log("Paymaster deployed at:", address(paymaster));
        console.log("MockToken deployed at:", address(mockToken));

        vm.stopBroadcast();
    }
}
