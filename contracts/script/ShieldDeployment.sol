// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Executor} from "../src/Executor.sol";
import {PositionRegistry} from "../src/PositionRegistry.sol";
import {Repricer} from "../src/Repricer.sol";
import {ShieldVault} from "../src/ShieldVault.sol";
import {ISwapper} from "../src/interfaces/ISwapper.sol";
import {IV3SwapRouter, UniswapV3Swapper} from "../src/swappers/UniswapV3Swapper.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";
import {IPoolAddressesProvider} from "aave-v3-origin/contracts/interfaces/IPoolAddressesProvider.sol";

/// @title ShieldDeployment
/// @notice Deploys and wires the Shield contracts. Used by script/Deploy.s.sol on mainnet and by the fork tests,
/// so both run the same sequence. The caller must be `cfg.owner` for the wiring calls to succeed.
library ShieldDeployment {
    struct Config {
        address owner;
        address keeper;
        IPoolAddressesProvider addressesProvider;
        IERC20 usdc;
        IPyth pyth;
        IV3SwapRouter swapRouter;
        address weth;
        bytes32 wethFeed;
        address cbbtc;
        bytes32 cbbtcFeed;
        uint64 k;
        uint64 sigmaFallback;
    }

    struct Deployed {
        PositionRegistry registry;
        ShieldVault vault;
        Repricer repricer;
        Executor executor;
        UniswapV3Swapper swapper;
    }

    /// @notice Calibrated k (ADR-022): 2% a year of covered debt at d = 0.05 and 80% volatility.
    uint64 internal constant K = 0.00125e18;
    /// @notice Sigma used until a feed has MIN_SAMPLES observations.
    uint64 internal constant SIGMA_FALLBACK = 0.8e18;

    function monadMainnet(address owner, address keeper) internal pure returns (Config memory c) {
        c.owner = owner;
        c.keeper = keeper;
        c.addressesProvider = IPoolAddressesProvider(0x34793Fb9935F7bB5E5aE920fb963F39063E7A615);
        c.usdc = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
        c.pyth = IPyth(0x2880aB155794e7179c9eE2e38200202908C17B43);
        c.swapRouter = IV3SwapRouter(0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900);
        c.weth = 0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242;
        c.wethFeed = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
        c.cbbtc = 0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b;
        c.cbbtcFeed = 0x2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97;
        c.k = K;
        c.sigmaFallback = SIGMA_FALLBACK;
    }

    function deploy(Config memory c) internal returns (Deployed memory d) {
        IPool pool = IPool(c.addressesProvider.getPool());
        IAaveOracle oracle = IAaveOracle(c.addressesProvider.getPriceOracle());

        d.registry = new PositionRegistry(c.owner);
        d.vault = new ShieldVault(c.owner, c.usdc, pool, oracle, d.registry);
        d.repricer = new Repricer(c.owner, d.registry, pool, oracle, c.pyth, c.usdc, d.vault);
        d.executor =
            new Executor(c.owner, d.registry, d.repricer, d.vault, c.addressesProvider, c.pyth, c.usdc);
        d.swapper = new UniswapV3Swapper(c.owner, c.swapRouter);

        d.registry.setModules(address(d.repricer), address(d.executor));
        d.vault.setModules(address(d.executor), address(d.repricer));
        d.vault.setSwapper(ISwapper(address(d.swapper)), 300);
        if (c.keeper != address(0)) d.vault.setUnwinder(c.keeper);
        d.executor.setSwapper(ISwapper(address(d.swapper)));
        d.registry.setAsset(c.weth, c.wethFeed, c.k, c.sigmaFallback, true);
        if (c.cbbtc != address(0)) d.registry.setAsset(c.cbbtc, c.cbbtcFeed, c.k, c.sigmaFallback, true);
    }
}
