// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title Executor
/// @notice The exit: vault funds or a flash loan repay the borrower's Aave debt, aTokens worth (1 + discount) x repaid move to the vault, HF must improve and stay above 1.0 (ADR-021).
/// @dev Implemented in M2. See docs/SPEC.md and docs/TECH-DECISIONS.md.
contract Executor {}
