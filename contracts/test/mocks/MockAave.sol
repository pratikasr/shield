// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {DataTypes} from "aave-v3-origin/contracts/protocol/libraries/types/DataTypes.sol";

/// @notice Test-only stand-in for the parts of Aave's Pool the unit tests read. Fork tests use the real Pool.
contract MockAavePool {
    struct Account {
        uint256 collateralBase;
        uint256 debtBase;
        uint256 healthFactor;
    }

    mapping(address => Account) public accounts;
    mapping(address => uint256) public eMode;
    mapping(address => uint256) public configData;
    mapping(address => address) public aTokens;
    mapping(address => address) public debtTokens;

    function setAccount(address user, uint256 collateralBase, uint256 debtBase, uint256 healthFactor)
        external
    {
        accounts[user] = Account(collateralBase, debtBase, healthFactor);
    }

    function setReserve(
        address asset,
        address aToken,
        address debtToken,
        uint256 lt,
        uint256 bonus,
        uint256 dec
    ) external {
        aTokens[asset] = aToken;
        debtTokens[asset] = debtToken;
        configData[asset] = (lt << 16) | (bonus << 32) | (dec << 48);
    }

    function getUserAccountData(address user)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        Account memory a = accounts[user];
        uint256 hf = a.debtBase == 0 ? type(uint256).max : a.healthFactor;
        return (a.collateralBase, a.debtBase, 0, 0, 0, hf);
    }

    function getUserEMode(address user) external view returns (uint256) {
        return eMode[user];
    }

    function getConfiguration(address asset)
        external
        view
        returns (DataTypes.ReserveConfigurationMap memory m)
    {
        m.data = configData[asset];
    }

    function getReserveAToken(address asset) external view returns (address) {
        return aTokens[asset];
    }

    function getReserveVariableDebtToken(address asset) external view returns (address) {
        return debtTokens[asset];
    }
}

/// @notice Test-only price oracle in Aave base currency (USD x 1e8).
contract MockAaveOracle {
    mapping(address => uint256) public prices;

    function setPrice(address asset, uint256 price) external {
        prices[asset] = price;
    }

    function getAssetPrice(address asset) external view returns (uint256) {
        return prices[asset];
    }
}

/// @notice Test-only Repricer stand-in for vault unit tests: a settable pending premium the vault can sweep.
contract MockRepricer {
    uint256 public pendingPremium;
    address public vault;

    function setVault(address vault_) external {
        vault = vault_;
    }

    function setPending(uint256 amount) external {
        pendingPremium = amount;
    }

    function sweep() external returns (uint256 amount) {
        amount = pendingPremium;
        pendingPremium = 0;
    }
}
