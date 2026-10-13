// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";
import {IRepricer} from "./interfaces/IRepricer.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title ShieldForwarder
/// @notice One account's deposit address on Monad. Tokens sent here, by Aurora Intents from another chain or by a
/// plain transfer, wait until the factory pulls them into Shield. Only the factory that deployed it can move them.
contract ShieldForwarder {
    using SafeERC20 for IERC20;

    address public immutable factory;

    error NotFactory();

    constructor() {
        factory = msg.sender;
    }

    /// @notice Sends this forwarder's whole balance of `token` to `to`. Factory only.
    function pull(IERC20 token, address to) external returns (uint256 amount) {
        if (msg.sender != factory) revert NotFactory();
        amount = token.balanceOf(address(this));
        if (amount != 0) token.safeTransfer(to, amount);
    }
}

/// @title ShieldForwarderFactory
/// @notice Deposit-and-execute on arrival for Shield (ADR-039). Every borrower has a deposit address, a forwarder
/// at a CREATE2 address derived from the borrower, known before it is deployed. Aurora Intents delivers USDC from
/// any supported chain to that address; `sweepPremium` then deploys the forwarder if needed and turns its balance
/// into the borrower's prepaid premium through `Repricer.topUpFor`. The protocol treasury funds the vault the same
/// way through its own forwarder and `sweepVault`. Both sweeps are permissionless: they only move tokens already sent
/// for that purpose, to the account they were sent for.
contract ShieldForwarderFactory is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice Salt of the treasury's forwarder. A borrower's salt is its address, which has 96 leading zero bits,
    /// so the two can never collide.
    bytes32 public constant TREASURY_SALT = keccak256("shield.forwarder.treasury.v1");
    bytes32 private constant INIT_CODE_HASH = keccak256(type(ShieldForwarder).creationCode);

    IERC20 public immutable asset;
    IRepricer public immutable repricer;
    IERC4626 public immutable vault;
    IPositionRegistry public immutable registry;

    event ForwarderDeployed(bytes32 indexed salt, address forwarder);
    event PremiumSwept(address indexed borrower, address indexed forwarder, uint256 amount);
    event VaultFunded(address indexed treasury, address indexed forwarder, uint256 assets, uint256 shares);

    error ZeroBorrower();

    constructor(IERC20 asset_, IRepricer repricer_, IERC4626 vault_, IPositionRegistry registry_) {
        asset = asset_;
        repricer = repricer_;
        vault = vault_;
        registry = registry_;
    }

    /// @notice The deposit address for `borrower`'s premium, whether or not its forwarder is deployed yet.
    function forwarderFor(address borrower) external view returns (address) {
        return _predict(_salt(borrower));
    }

    /// @notice The deposit address that funds the vault for the protocol treasury.
    function treasuryForwarder() external view returns (address) {
        return _predict(TREASURY_SALT);
    }

    /// @notice Moves the USDC waiting at `borrower`'s deposit address into their prepaid premium. Anyone may call
    /// it; it returns 0 when nothing is waiting.
    function sweepPremium(address borrower) external nonReentrant returns (uint256 amount) {
        if (borrower == address(0)) revert ZeroBorrower();
        address forwarder = _deployed(_salt(borrower));
        amount = ShieldForwarder(forwarder).pull(asset, address(this));
        if (amount == 0) return 0;
        asset.forceApprove(address(repricer), amount);
        repricer.topUpFor(borrower, amount);
        emit PremiumSwept(borrower, forwarder, amount);
    }

    /// @notice Deposits the USDC waiting at the treasury's deposit address into the vault, with the shares going to
    /// the registry's current treasury. Anyone may call it; it returns zeros when nothing is waiting.
    function sweepVault() external nonReentrant returns (uint256 assets, uint256 shares) {
        address forwarder = _deployed(TREASURY_SALT);
        assets = ShieldForwarder(forwarder).pull(asset, address(this));
        if (assets == 0) return (0, 0);
        address treasury = registry.treasury();
        asset.forceApprove(address(vault), assets);
        shares = vault.deposit(assets, treasury);
        emit VaultFunded(treasury, forwarder, assets, shares);
    }

    function _salt(address borrower) private pure returns (bytes32) {
        return bytes32(uint256(uint160(borrower)));
    }

    function _predict(bytes32 salt) private view returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, INIT_CODE_HASH))))
        );
    }

    function _deployed(bytes32 salt) private returns (address forwarder) {
        forwarder = _predict(salt);
        if (forwarder.code.length == 0) {
            forwarder = address(new ShieldForwarder{salt: salt}());
            emit ForwarderDeployed(salt, forwarder);
        }
    }
}
