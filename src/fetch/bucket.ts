import { BigInt, ethereum } from "@graphprotocol/graph-ts";
import { OptionTypeBucket, ClaimBucket, Claim } from "../../generated/schema";
import { fetchTransaction } from "./transaction";
import { fetchAccount } from "./account";

/**
 * Searches for and returns an OptionTypeBucket, initializing a new one if not found
 * @param {string} optionId
 * @param {number} bucketIndex
 * @return {OptionTypeBucket}
 */
export function fetchOptionTypeBucket(
  optionId: string,
  bucketIndex: BigInt
): OptionTypeBucket {
  const optionTypeBucketId = optionId
    .concat("-")
    .concat(bucketIndex.toString())
    .toLowerCase();

  let optionTypeBucket = OptionTypeBucket.load(optionTypeBucketId);
  if (optionTypeBucket) return optionTypeBucket;

  optionTypeBucket = new OptionTypeBucket(optionTypeBucketId);
  optionTypeBucket.optionType = optionId;
  optionTypeBucket.claimBuckets = [];
  optionTypeBucket.amountWritten = BigInt.fromI32(0);
  optionTypeBucket.amountExercised = BigInt.fromI32(0);
  optionTypeBucket.save();

  return optionTypeBucket;
}

/**
 * Searches for and returns a ClaimBucket, initializing a new one if not found
 * @param {string} optionId
 * @param {number} bucketIndex
 * @param {string} claimId
 * @return {ClaimBucket}
 */
export function fetchClaimBucket(
  optionId: string,
  bucketIndex: BigInt,
  claimId: string
): ClaimBucket {
  const optionTypeBucket = fetchOptionTypeBucket(optionId, bucketIndex);

  const claimBucketId = claimId
    .concat("-")
    .concat(optionTypeBucket.id)
    .toLowerCase();

  let claimBucket = ClaimBucket.load(claimBucketId);
  if (claimBucket) return claimBucket;

  claimBucket = new ClaimBucket(claimBucketId);
  claimBucket.claim = claimId;
  claimBucket.optionTypeBucket = optionTypeBucket.id;
  claimBucket.amountWritten = BigInt.fromI32(0);
  claimBucket.amountExercised = BigInt.fromI32(0);
  claimBucket.save();

  return claimBucket;
}

/**
 * Searches for and returns a Claim, initializing a new one if not found
 * @param {string} claimId
 * @param {string} optionTypeId
 * @param {string} writerId
 * @param {ethereum.Event} event
 * @return {Claim}
 */
export function fetchClaim(
  claimId: string,
  optionTypeId: string,
  writerId: string,
  event: ethereum.Event
): Claim {
  let claim = Claim.load(claimId);
  if (claim) return claim;

  claim = new Claim(claimId);
  claim.optionType = optionTypeId;
  claim.writer = fetchAccount(writerId).id;
  claim.writeTx = fetchTransaction(event).id;
  claim.redeemed = false;
  claim.amountWritten = BigInt.fromString("0");
  claim.amountExercised = BigInt.fromString("0");
  claim.claimBuckets = [];
  claim.save();
  return claim;
}
