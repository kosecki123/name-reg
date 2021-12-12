# Name Registry

Vanity name registration contract.

Rent requires prior reservation based on commitment hash. To generate commitment hash use `generateCommitment` function. Rent can be done after 5min of grace period after reservation.

Rent requires the value to be set that can be calculated using function `calculateCost(name)`, cost depends on the length of the name, 10 wei per char.

After rent expiry, owner can renew within 7 days before expiry date or release funds after reaching expiry. After expiry the previous owner has to go with reserve and rent process again.

## Install

npm install

## Compile

npx hardhat compile

## Test

npx hardhat test
