import { BigInt, ethereum } from "@graphprotocol/graph-ts";
import { Bucket, Claim } from "../../generated/schema";
import { fetchTransaction } from "./transaction";
import { fetchAccount } from "./account";

/**
 * Searches for and returns a Bucket, initializing a new one if not found
 * @param {string} optionId
 * @param {number} bucketIndex
 * @param {string} claimId
 * @return {Bucket}
 */
export function fetchBucket(
  optionId: string,
  bucketIndex: BigInt,
  claimId: string
): Bucket {
  const bucketId = optionId.concat("-").concat(bucketIndex.toString());

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

  let optionTypeId = optionId;
  let isClaim = Claim.load(optionId) != null;
  if (isClaim) {
    optionTypeId = Claim.load(optionId)!.optionType;
  }

  bucket.optionType = optionTypeId;
  bucket.claims = [claimId];
  bucket.amountWritten = BigInt.fromI32(0);
  bucket.amountExercised = BigInt.fromI32(0);
  bucket.save();

  return bucket;
}

// /**
//  * Searches for and returns a ClaimBucket, initializing a new one if not found
//  * @param {string} claimBucketId
//  * @return {ClaimBucket}
//  */
// export function fetchClaimBucket(claimBucketId: string): ClaimBucket {
//   const idArr = claimBucketId.split("-");
//   const claimId = idArr[0];
//   const bucketId = idArr[1].concat("-").concat(idArr[2]);

//   log.error("claimId {}, bucketId {}", [claimId, bucketId]);

//   let claimBucket = ClaimBucket.load(claimBucketId);
//   if (claimBucket) return claimBucket;

//   claimBucket = new ClaimBucket(claimBucketId);
//   claimBucket.claim = claimId;
//   claimBucket.bucket = bucketId;
//   claimBucket.amountWritten = BigInt.fromI32(0);
//   claimBucket.amountExercised = BigInt.fromI32(0);
//   claimBucket.save();

//   return claimBucket;
// }

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
