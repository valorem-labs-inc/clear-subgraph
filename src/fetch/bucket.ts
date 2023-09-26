import { BigInt, ethereum } from "@graphprotocol/graph-ts";

import { Bucket, Claim } from "../../generated/schema";
import { fetchTransaction } from "./transaction";
import { fetchAccount } from "./account";
/**
 * Searches for and returns a Bucket, initializing a new one if not found
 * @param {string} optionTypeId
 * @param {number} bucketIndex
 * @param {string} claimId
 * @param {ethereum.Event} event
 * @return {Bucket}
 */
export function fetchBucket(
  optionTypeId: string,
  bucketIndex: BigInt,
  claimId: string
): Bucket {
  const bucketId = optionTypeId.concat("-").concat(bucketIndex.toString());
  let bucket = Bucket.load(bucketId);
  if (bucket) {
    if (!bucket.claims.includes(claimId)) {
      const claims = bucket.claims;
      claims.push(claimId);
      bucket.claims = claims;
      bucket.save();
    }
    return bucket;
  }

  bucket = new Bucket(bucketId);
  bucket.optionType = optionTypeId;
  bucket.claims = [Claim.load(claimId)!.id];
  bucket.amountWritten = BigInt.fromI32(0);
  bucket.amountExercised = BigInt.fromI32(0);
  bucket.save();
  return bucket;
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
  claim.save();
  return claim;
}
