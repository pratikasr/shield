// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PythPriceFeed} from "./PythPriceFeed.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {AaveV3Payload} from "aave-v3-origin/contracts/extensions/v3-config-engine/AaveV3Payload.sol";
import {EngineFlags} from "aave-v3-origin/contracts/extensions/v3-config-engine/EngineFlags.sol";
import {IAaveV3ConfigEngine as IEngine} from "aave-v3-origin/contracts/extensions/v3-config-engine/IAaveV3ConfigEngine.sol";
import {IACLManager} from "aave-v3-origin/contracts/interfaces/IACLManager.sol";
import {ACLManager} from "aave-v3-origin/contracts/protocol/configuration/ACLManager.sol";
import {TestnetERC20} from "aave-v3-origin/contracts/mocks/testnet-helpers/TestnetERC20.sol";
import {
    DeployFlags,
    MarketConfig,
    MarketReport,
    Roles
} from "aave-v3-origin/deployments/interfaces/IMarketReportTypes.sol";
import {AaveV3BatchOrchestration} from "aave-v3-origin/deployments/projects/aave-v3-batched/AaveV3BatchOrchestration.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @title TestnetListing
/// @notice Lists WETH and USDC on the testnet market through Aave's config engine, with the reserve parameters Aave V3
/// Monad uses on mainnet outside eMode (docs/TECH-DECISIONS.md, Verified facts, 5 Oct 2026): WETH 80.50% LTV, 84.00%
/// liquidation threshold, 5.50% bonus; USDC 75.00%, 78.00%, 7.50%, borrowable. Both are priced by Pyth.
contract TestnetListing is AaveV3Payload {
    bytes32 internal constant POOL_ADMIN_ROLE = keccak256("POOL_ADMIN");

    address public immutable weth;
    address public immutable wethFeed;
    address public immutable usdc;
    address public immutable usdcFeed;
    IACLManager public immutable acl;

    constructor(IEngine engine, IACLManager acl_, address weth_, address wethFeed_, address usdc_, address usdcFeed_)
        AaveV3Payload(engine)
    {
        acl = acl_;
        weth = weth_;
        wethFeed = wethFeed_;
        usdc = usdc_;
        usdcFeed = usdcFeed_;
    }

    function newListings() public view override returns (IEngine.Listing[] memory l) {
        l = new IEngine.Listing[](2);
        l[0] = IEngine.Listing({
            asset: weth,
            assetSymbol: "WETH",
            priceFeed: wethFeed,
            rateStrategyParams: IEngine.InterestRateInputData({
                optimalUsageRatio: 90_00, baseVariableBorrowRate: 0, variableRateSlope1: 2_70, variableRateSlope2: 80_00
            }),
            enabledToBorrow: EngineFlags.ENABLED,
            flashloanable: EngineFlags.ENABLED,
            ltv: 80_50,
            liqThreshold: 84_00,
            liqBonus: 5_50,
            reserveFactor: 15_00,
            supplyCap: 0,
            borrowCap: 0,
            liqProtocolFee: 10_00
        });
        l[1] = IEngine.Listing({
            asset: usdc,
            assetSymbol: "USDC",
            priceFeed: usdcFeed,
            rateStrategyParams: IEngine.InterestRateInputData({
                optimalUsageRatio: 90_00, baseVariableBorrowRate: 0, variableRateSlope1: 6_00, variableRateSlope2: 40_00
            }),
            enabledToBorrow: EngineFlags.ENABLED,
            flashloanable: EngineFlags.ENABLED,
            ltv: 75_00,
            liqThreshold: 78_00,
            liqBonus: 7_50,
            reserveFactor: 10_00,
            supplyCap: 0,
            borrowCap: 0,
            liqProtocolFee: 10_00
        });
    }

    function getPoolContext() public pure override returns (IEngine.PoolContext memory) {
        return IEngine.PoolContext({networkName: "Monad Testnet", networkAbbreviation: "MonTest"});
    }

    function _postExecute() internal override {
        ACLManager(address(acl)).renounceRole(POOL_ADMIN_ROLE, address(this));
    }
}

/// @title TestnetMarket
/// @notice Monad testnet only (Aave V3 is not deployed there; ADR-040). Deploys a full Aave V3 market from Aave's own
/// code (aave-v3-origin, its batched deployment), two mintable test tokens named WETH and USDC, and Pyth price feeds
/// for them, then lists both with Aave Monad's mainnet parameters. The deployer is the market's owner and pool admin.
/// Writes deployments/aave-10143.json, which script/Deploy.s.sol reads when SHIELD_NETWORK=testnet.
///
///   FOUNDRY_PROFILE=testnet forge script testnet/TestnetMarket.s.sol --rpc-url $MONAD_TESTNET_RPC_URL \
///     --private-key ... --broadcast --slow
contract TestnetMarket is Script {
    IPyth internal constant PYTH = IPyth(0x2880aB155794e7179c9eE2e38200202908C17B43);
    bytes32 internal constant ETH_USD = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 internal constant USDC_USD = 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a;

    function run() external returns (MarketReport memory r) {
        require(block.chainid == 10_143, "Monad testnet only");
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        TestnetERC20 weth = new TestnetERC20("Wrapped Ether (Shield testnet)", "WETH", 18, deployer);
        TestnetERC20 usdc = new TestnetERC20("USD Coin (Shield testnet)", "USDC", 6, deployer);
        PythPriceFeed wethFeed = new PythPriceFeed(PYTH, ETH_USD, "ETH / USD, Pyth");
        PythPriceFeed usdcFeed = new PythPriceFeed(PYTH, USDC_USD, "USDC / USD, Pyth");

        Roles memory roles = Roles({marketOwner: deployer, poolAdmin: deployer, emergencyAdmin: deployer});
        MarketConfig memory config;
        config.marketId = "Shield testnet market (Aave V3 code)";
        config.providerId = 10_143;
        config.oracleDecimals = 8;
        config.flashLoanPremium = 0.0005e4; // 5 bps, as Aave Monad
        DeployFlags memory flags;
        r = AaveV3BatchOrchestration.deployAaveV3(deployer, roles, config, flags, r);

        TestnetListing listing = new TestnetListing(
            IEngine(r.configEngine),
            IACLManager(r.aclManager),
            address(weth),
            address(wethFeed),
            address(usdc),
            address(usdcFeed)
        );
        IACLManager(r.aclManager).addPoolAdmin(address(listing));
        listing.execute();
        vm.stopBroadcast();

        string memory k = "aave";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "block", block.number);
        vm.serializeAddress(k, "owner", deployer);
        vm.serializeAddress(k, "PoolAddressesProvider", r.poolAddressesProvider);
        vm.serializeAddress(k, "Pool", r.poolProxy);
        vm.serializeAddress(k, "PoolConfigurator", r.poolConfiguratorProxy);
        vm.serializeAddress(k, "AaveOracle", r.aaveOracle);
        vm.serializeAddress(k, "ProtocolDataProvider", r.protocolDataProvider);
        vm.serializeAddress(k, "ACLManager", r.aclManager);
        vm.serializeAddress(k, "WETH", address(weth));
        vm.serializeAddress(k, "USDC", address(usdc));
        vm.serializeAddress(k, "WETHPriceFeed", address(wethFeed));
        string memory json = vm.serializeAddress(k, "USDCPriceFeed", address(usdcFeed));
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/aave-10143.json"));

        console2.log("Pool", r.poolProxy);
        console2.log("PoolAddressesProvider", r.poolAddressesProvider);
        console2.log("AaveOracle", r.aaveOracle);
        console2.log("WETH", address(weth));
        console2.log("USDC", address(usdc));
        console2.log("WETH price, 8 decimals", uint256(wethFeed.latestAnswer()));
    }
}
