// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Monad mainnet (chain 143) addresses, verified 5 Oct 2026 (docs/TECH-DECISIONS.md, Verified facts).
library MonadAddresses {
    address internal constant POOL_ADDRESSES_PROVIDER = 0x34793Fb9935F7bB5E5aE920fb963F39063E7A615;
    address internal constant POOL = 0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef;
    address internal constant AAVE_ORACLE = 0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf;
    address internal constant ACL_MANAGER = 0xa9fEe192a76B8f5e5f3d310AB6C526cB11F3d95B;
    address internal constant ACL_ADMIN = 0xa9d0EAFF48cE1DF468f9eAeb7e628c413343F6A2;
    address internal constant POOL_CONFIGURATOR = 0xC7A386Da9cB528aa86feD862a7bf33d10AA8455B;

    address internal constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address internal constant A_USDC = 0x35a73BAcb179d3740395A3ceCc87FF2e581d6042;
    address internal constant V_USDC = 0x9F555aB84C4e0a531B50283f09Dba7A97134c4e4;
    address internal constant WETH = 0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242;
    address internal constant A_WETH = 0x4377b53aAA8b8e3fF7AA2843832CAF004f5Cb8b6;
    address internal constant CBBTC = 0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b;

    address internal constant PYTH = 0x2880aB155794e7179c9eE2e38200202908C17B43;
    bytes32 internal constant ETH_USD_FEED =
        0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 internal constant CBBTC_USD_FEED =
        0x2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97;
    bytes32 internal constant BTC_USD_FEED =
        0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;

    address internal constant UNISWAP_SWAP_ROUTER_02 = 0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900;
}
