//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "hardhat/console.sol";

contract NameRegistry {
    uint256 public constant costPerByte = 10 wei;
    uint256 public constant registrationPeriod = 365 days;
    uint256 public constant gracePeriod = 5 minutes;
    uint256 public constant renewPeriod = 7 days;

    struct Entry {
        address owner;
        uint256 expiry;
    }

    mapping(bytes32 => uint256) private pendingCommitments;
    mapping(string => Entry) private registry;
    mapping(address => mapping(string => uint256)) funds;

    event Reserved(address indexed owner, uint256 expiry);
    event Rented(address indexed owner, string name, uint256 expiry);

    function generateCommitment(string memory name, bytes32 seed) public view returns (bytes32) {
        return keccak256(abi.encodePacked(name, seed, msg.sender));
    }

    function calculateCost(string memory name) public pure returns (uint256) {
        return bytes(name).length * costPerByte;
    }

    function isAvailable(string calldata name) public view returns (bool) {
        return registry[name].owner == address(0) || registry[name].expiry < block.timestamp;
    }

    function reserve(bytes32 commitment) public {
        require(pendingCommitments[commitment] == 0, "Already reserved");

        uint256 reservationExpiry = block.timestamp + gracePeriod;

        pendingCommitments[commitment] = reservationExpiry;

        emit Reserved(msg.sender,reservationExpiry );
    }

    function rent(string calldata name, bytes32 seed) public payable {
        require(isAvailable(name), "Name already taken");

        bytes32 commitment = generateCommitment(name, seed);

        require(pendingCommitments[commitment] > 0, "Unknown commitment");
        require(pendingCommitments[commitment] <= block.timestamp, "In the grace period");

        uint256 cost = calculateCost(name);

        require(msg.value >= cost, "Insufficient value");

        uint256 expiry = block.timestamp + registrationPeriod;

        registry[name] = Entry({
            owner : msg.sender,
            expiry : expiry
        });

        // track funds for given name
        // since cost is fixed, no need to track cost as it can be calculated
        funds[msg.sender][name] = expiry;

        delete pendingCommitments[commitment];

        if (msg.value > cost) {
            payable(msg.sender).transfer(msg.value - cost);
        }

        emit Rented(msg.sender, name, expiry);
    }

    function renew(string calldata name) public {
        Entry memory entry = registry[name];

        require(entry.owner == msg.sender, "Not an owner");
        require(entry.expiry >= block.timestamp, "Expired");
        require(entry.expiry - renewPeriod <= block.timestamp, "Too early to renew");

        // prolong for the next year
        registry[name].expiry += registrationPeriod;
    }

    function releaseFunds(string calldata name) public {
        require(funds[msg.sender][name] > 0, "No locked funds");

        Entry memory entry = registry[name];

        require(entry.owner != msg.sender || (entry.owner == msg.sender && entry.expiry < block.timestamp), "Still owned or not expired");
        require(funds[msg.sender][name] < block.timestamp, "Funds locked");

        uint256 amount = calculateCost(name);
        delete funds[msg.sender][name];

        payable(msg.sender).transfer(amount);
    }
}