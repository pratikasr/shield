// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title PositionRegistry
/// @notice One packed record per opted-in borrower, each at a page-aligned base slot so one MIP-8 page holds the whole record (ADR-008).
/// @dev Implemented in M2. See docs/SPEC.md and docs/TECH-DECISIONS.md.
contract PositionRegistry {}
