import { parseAbi } from "viem";

/** Minimal Aave V3 and ERC-20 ABIs for the reads and writes the app makes. Shield ABIs are generated. */
export { executorAbi } from "./abi/Executor";
export { positionRegistryAbi } from "./abi/PositionRegistry";
export { repricerAbi } from "./abi/Repricer";
export { shieldVaultAbi } from "./abi/ShieldVault";

export const aavePoolAbi = [
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getReservesList",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "getReserveAToken",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getReserveVariableDebtToken",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getUserEMode",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const aaveOracleAbi = [
  {
    type: "function",
    name: "getAssetsPrices",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "address[]" }],
    outputs: [{ type: "uint256[]" }],
  },
] as const;

export const aaveDataProviderAbi = [
  {
    type: "function",
    name: "getReserveConfigurationData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "decimals", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "liquidationThreshold", type: "uint256" },
      { name: "liquidationBonus", type: "uint256" },
      { name: "reserveFactor", type: "uint256" },
      { name: "usageAsCollateralEnabled", type: "bool" },
      { name: "borrowingEnabled", type: "bool" },
      { name: "stableBorrowRateEnabled", type: "bool" },
      { name: "isActive", type: "bool" },
      { name: "isFrozen", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getUserReserveData",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "currentATokenBalance", type: "uint256" },
      { name: "currentStableDebt", type: "uint256" },
      { name: "currentVariableDebt", type: "uint256" },
      { name: "principalStableDebt", type: "uint256" },
      { name: "scaledVariableDebt", type: "uint256" },
      { name: "stableBorrowRate", type: "uint256" },
      { name: "liquidityRate", type: "uint256" },
      { name: "stableRateLastUpdated", type: "uint40" },
      { name: "usageAsCollateralEnabled", type: "bool" },
    ],
  },
] as const;

/** Pyth's on-chain price read (the push feed the exit checks). */
export const pythAbi = parseAbi(["function getPriceUnsafe(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))"]);

/** Multicall3's block timestamp, read in the same call as the cover so countdowns use chain time. */
export const multicall3Abi = parseAbi(["function getCurrentBlockTimestamp() view returns (uint256 timestamp)"]);

/**
 * Errors raised below Shield's contracts (Aave's Pool and OpenZeppelin tokens), added to every simulation so a revert
 * deep inside an exit or a transfer decodes to a name the app can explain.
 */
export const externalErrorsAbi = parseAbi([
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error HealthFactorLowerThanLiquidationThreshold()",
  "error LtvValidationFailed()",
  "error UserHasAssetWithZeroLtv()",
  "error NotEnoughAvailableUserBalance()",
  "error ReservePaused()",
  "error ReserveFrozen()",
  "error InvalidAmount()",
  "error NoDebtOfSelectedType()",
]);

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;
