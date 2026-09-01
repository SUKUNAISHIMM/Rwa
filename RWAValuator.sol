// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RWAValuator
 * @notice Stores compact, verifiable valuation anchors. Full reports remain off-chain.
 */
contract RWAValuator {
    struct Valuation {
        string assetId;
        string assetType;
        string currency;
        uint256 estimatedValue;
        uint256 riskScore;
        uint256 confidenceScore;
        bytes32 reportHash;
        address submitter;
        uint256 timestamp;
    }

    mapping(string => Valuation) private valuations;

    event ValuationRecorded(
        string assetId,
        string assetType,
        string currency,
        uint256 estimatedValue,
        uint256 riskScore,
        uint256 confidenceScore,
        bytes32 reportHash,
        address indexed submitter,
        uint256 timestamp
    );

    function recordValuation(
        string calldata assetId,
        string calldata assetType,
        string calldata currency,
        uint256 estimatedValue,
        uint256 riskScore,
        uint256 confidenceScore,
        bytes32 reportHash
    ) external {
        require(bytes(assetId).length > 0, "Asset ID required");
        require(bytes(assetType).length > 0, "Asset type required");
        require(bytes(currency).length > 0, "Currency required");
        require(riskScore <= 100, "Risk score must be <= 100");
        require(confidenceScore <= 100, "Confidence score must be <= 100");

        Valuation memory valuation = Valuation({
            assetId: assetId,
            assetType: assetType,
            currency: currency,
            estimatedValue: estimatedValue,
            riskScore: riskScore,
            confidenceScore: confidenceScore,
            reportHash: reportHash,
            submitter: msg.sender,
            timestamp: block.timestamp
        });

        valuations[assetId] = valuation;

        emit ValuationRecorded(
            assetId,
            assetType,
            currency,
            estimatedValue,
            riskScore,
            confidenceScore,
            reportHash,
            msg.sender,
            block.timestamp
        );
    }

    function getValuation(string calldata assetId)
        external
        view
        returns (
            string memory,
            string memory,
            string memory,
            uint256,
            uint256,
            uint256,
            bytes32,
            address,
            uint256
        )
    {
        Valuation memory valuation = valuations[assetId];
        return (
            valuation.assetId,
            valuation.assetType,
            valuation.currency,
            valuation.estimatedValue,
            valuation.riskScore,
            valuation.confidenceScore,
            valuation.reportHash,
            valuation.submitter,
            valuation.timestamp
        );
    }
}