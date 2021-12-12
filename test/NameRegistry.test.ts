import { NameRegistry } from "../typechain";
import NameRegistryJSON from "../artifacts/contracts/NameRegistry.sol/NameRegistry.json";
import { BigNumber } from "ethers";

const { expect, use } = require("chai");
const { ethers, waffle } = require("hardhat");
const { solidity, deployContract } = waffle;

use(solidity);

describe("NameRegistry", function () {
  let nameRegistryAsUser1: NameRegistry;
  let nameRegistryAsUser2: NameRegistry;

  async function deploy() {
    const [deployer, user1, user2] = await ethers.getSigners();
    const contract = await deployContract(deployer, NameRegistryJSON);
    const nameRegistry = contract as NameRegistry;

    return {
      nameRegistryAsUser1: nameRegistry.connect(user1),
      nameRegistryAsUser2: nameRegistry.connect(user2),
    };
  }

  async function timeTravel(seconds: number | BigNumber) {
    if (seconds instanceof BigNumber) {
      seconds = (seconds as BigNumber).toNumber();
    }

    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  async function prepareCommitment(
    name = "test.eth",
    registry = nameRegistryAsUser1
  ) {
    const seed = ethers.utils.randomBytes(32);

    const commitment = await registry.generateCommitment(name, seed);
    const cost = await registry.calculateCost(name);

    return { commitment, seed, name, cost };
  }

  async function prepareAndReserveCommitment(
    timeOffset = 0,
    name = "test.eth",
    registry = nameRegistryAsUser1
  ) {
    const gracePeriod = await registry.gracePeriod();

    const { commitment, seed, cost } = await prepareCommitment(name, registry);

    await registry.reserve(commitment);

    await timeTravel(gracePeriod.add(timeOffset));

    return { commitment, seed, name, cost };
  }

  beforeEach(async function () {
    ({ nameRegistryAsUser1, nameRegistryAsUser2 } = await deploy());
  });

  it("Should generate commitment", async function () {
    const seed = ethers.utils.randomBytes(32);
    const name = "test.eth";
    const sender = await nameRegistryAsUser1.signer.getAddress();

    const commitment = await nameRegistryAsUser1.generateCommitment(name, seed);

    const hexCommitment = ethers.utils.hexlify(commitment);

    const expected = ethers.utils.solidityKeccak256(
      ["string", "bytes32", "address"],
      [name, seed, sender]
    );

    expect(hexCommitment).to.equal(expected);
  });

  it("should calculate cost of the name", async function () {
    const name = "test.eth";

    const costPerByte = await nameRegistryAsUser1.costPerByte();
    const cost = await nameRegistryAsUser1.calculateCost(name);
    // solidity string are utf-8
    const expectedCost = costPerByte.mul(name.length);

    expect(cost).to.be.equal(expectedCost);
  });

  describe("Reserve", function () {
    it("should be able to reserve the name once", async function () {
      const { commitment } = await prepareCommitment();

      await nameRegistryAsUser1.reserve(commitment);

      expect(nameRegistryAsUser1.reserve(commitment)).to.be.revertedWith(
        "Already reserved"
      );
    });

    it("should allow user to reserve many names", async function () {
      const { commitment } = await prepareCommitment();

      await nameRegistryAsUser1.reserve(commitment);

      const { commitment: otherCommitment } = await prepareCommitment(
        "other.name.eth"
      );

      await nameRegistryAsUser1.reserve(otherCommitment);
    });
  });

  describe("Rent", function () {
    it("should be able to rent the name", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment();

      await nameRegistryAsUser1.rent(name, seed, { value: cost });
    });

    it("should be able to rent multiple names", async function () {
      const { commitment } = await prepareCommitment();

      await nameRegistryAsUser1.reserve(commitment);

      const { commitment: otherCommitment } = await prepareCommitment(
        "other.name.eth"
      );

      await nameRegistryAsUser1.reserve(otherCommitment);
    });

    it("should not be able to rent without knowing the seed", async function () {
      const { name, cost } = await prepareAndReserveCommitment();

      const otherSeed = ethers.utils.randomBytes(32);

      await expect(
        nameRegistryAsUser1.rent(name, otherSeed, { value: cost })
      ).to.be.revertedWith("Unknown commitment");
    });

    it("should fail when trying to rent before grace period", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment(-60);

      await expect(
        nameRegistryAsUser1.rent(name, seed, { value: cost })
      ).to.be.revertedWith("In the grace period");
    });

    it("should fail when insufficient funds were sent", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment();

      const value = cost.sub(1);

      await expect(
        nameRegistryAsUser1.rent(name, seed, { value })
      ).to.be.revertedWith("Insufficient value");
    });

    it("should return funds greater than the cost", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment();

      const excess = 5000;
      const value = cost.add(excess);

      await expect(
        await nameRegistryAsUser1.rent(name, seed, { value })
      ).to.changeEtherBalance(nameRegistryAsUser1.signer, cost.mul(-1));
    });
  });

  describe("Renew", function () {
    it("should allow owner to renew when expired and in grace period", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment();
      const registrationPeriod = await nameRegistryAsUser1.registrationPeriod();

      await nameRegistryAsUser1.rent(name, seed, { value: cost });

      await timeTravel(registrationPeriod.sub(10));

      await nameRegistryAsUser1.renew(name);
    });

    it("should not allow owner to renew when expired and grace period expired", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment();
      const registrationPeriod = await nameRegistryAsUser1.registrationPeriod();

      await nameRegistryAsUser1.rent(name, seed, { value: cost });

      await timeTravel(registrationPeriod.add(10));

      await expect(nameRegistryAsUser1.renew(name)).to.be.revertedWith(
        "Expired"
      );
    });

    it("should not allow owner to renew when it is too early to renew", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment();
      const registrationPeriod = await nameRegistryAsUser1.registrationPeriod();
      const renewPeriod = await nameRegistryAsUser1.renewPeriod();

      await nameRegistryAsUser1.rent(name, seed, { value: cost });

      await timeTravel(
        registrationPeriod.toNumber() - renewPeriod.toNumber() - 10
      );

      await expect(nameRegistryAsUser1.renew(name)).to.be.revertedWith(
        "Too early to renew"
      );
    });
  });

  describe("Release funds", function () {
    it("should not allow owner to release funds before expiry", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment();

      await nameRegistryAsUser1.rent(name, seed, { value: cost });

      await expect(nameRegistryAsUser1.releaseFunds(name)).to.be.revertedWith(
        "Still owned or not expired"
      );
    });

    it("should not allow owner to release funds many times", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment();

      await nameRegistryAsUser1.rent(name, seed, { value: cost });

      const registrationPeriod = await nameRegistryAsUser1.registrationPeriod();

      await timeTravel(registrationPeriod.add(1));

      await nameRegistryAsUser1.releaseFunds(name);

      await expect(nameRegistryAsUser1.releaseFunds(name)).to.be.revertedWith(
        "No locked funds"
      );
    });

    it("should not allow non owner to release funds", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment();

      await nameRegistryAsUser1.rent(name, seed, { value: cost });

      await expect(nameRegistryAsUser2.releaseFunds(name)).to.be.revertedWith(
        "No locked funds"
      );
    });

    it("should allow owner to release funds after name expiry", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment();

      await nameRegistryAsUser1.rent(name, seed, { value: cost });

      const registrationPeriod = await nameRegistryAsUser1.registrationPeriod();

      await timeTravel(registrationPeriod.add(1));

      await expect(
        await nameRegistryAsUser1.releaseFunds(name)
      ).to.changeEtherBalance(nameRegistryAsUser1.signer, cost);
    });
  });

  describe("E2E", function () {
    it("owner1: rent->expiry owner2: rent, owner1: release funds", async function () {
      const { name, seed, cost } = await prepareAndReserveCommitment();
      await nameRegistryAsUser1.rent(name, seed, { value: cost });

      const registrationPeriod = await nameRegistryAsUser1.registrationPeriod();

      await timeTravel(registrationPeriod.add(1));

      const { seed: otherSeed } = await prepareAndReserveCommitment(
        0,
        name,
        nameRegistryAsUser2
      );

      await nameRegistryAsUser2.rent(name, otherSeed, { value: cost });

      await nameRegistryAsUser1.releaseFunds(name);
    });
  });

  it("should not be able possible to front run other user even knowing seed", async function () {
    const { commitment, name, seed } = await prepareCommitment();

    await nameRegistryAsUser1.reserve(commitment);
    const gracePeriod = await nameRegistryAsUser1.gracePeriod();

    // both should be able to rent
    await timeTravel(gracePeriod.add(10));

    await expect(nameRegistryAsUser2.rent(name, seed)).to.revertedWith(
      "Unknown commitment"
    );
  });
});
