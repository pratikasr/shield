// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @title PythPriceFeed
/// @notice Monad testnet only. Gives the Aave oracle of Shield's testnet market (script/TestnetMarket.s.sol) a Pyth
/// price in the 8-decimal `latestAnswer` form Aave reads, so that market is priced by Pyth's live testnet feeds rather
/// than by fixed mock prices. It returns the latest stored price without a staleness check, as Aave's oracle does with
/// any source; Shield's keeper pushes a fresh Pyth update with every reprice and exit. Not used on mainnet, where Shield
/// runs on Aave V3 Monad and its own oracle.
contract PythPriceFeed {
    IPyth public immutable pyth;
    bytes32 public immutable feedId;
    string public description;

    constructor(IPyth pyth_, bytes32 feedId_, string memory description_) {
        pyth = pyth_;
        feedId = feedId_;
        description = description_;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    /// @notice The latest Pyth price scaled to 8 decimals.
    function latestAnswer() public view returns (int256) {
        PythStructs.Price memory p = pyth.getPriceUnsafe(feedId);
        int256 price = int256(p.price);
        int32 shift = p.expo + 8;
        if (shift >= 0) return price * int256(10 ** uint256(uint32(shift)));
        return price / int256(10 ** uint256(uint32(-shift)));
    }

    function latestTimestamp() external view returns (uint256) {
        return pyth.getPriceUnsafe(feedId).publishTime;
    }
}
