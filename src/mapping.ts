import {
  Address,
  BigDecimal,
  BigInt,
  ethereum,
  log,
} from "@graphprotocol/graph-ts";
import {
  OptionType,
  Claim,
  Account,
  ERC1155Contract,
  ERC1155Transfer,
  Bucket,
} from "../generated/schema";
import {
  ValoremOptionsClearinghouse as OCHContract,
  ApprovalForAll as ApprovalForAllEvent,
  ClaimRedeemed as ClaimRedeemedEvent,
  FeeAccrued as FeeAccruedEvent,
  FeeSwept as FeeSweptEvent,
  NewOptionType as NewOptionTypeEvent,
  OptionsExercised as OptionsExercisedEvent,
  OptionsWritten as OptionsWrittenEvent,
  TransferBatch as TransferBatchEvent,
  TransferSingle as TransferSingleEvent,
  URI as URIEvent,
  FeeToUpdated as FeeToUpdatedEvent,
  FeeSwitchUpdated as FeeSwitchUpdatedEvent,
  BucketAssignedExercise as BucketAssignedExerciseEvent,
  BucketWrittenInto as BucketWrittenIntoEvent,
} from "../generated/ValoremOptionsClearinghouse/ValoremOptionsClearinghouse";
import { fetchAccount } from "./fetch/account";
import { fetchBucket, fetchClaim } from "./fetch/bucket";
import {
  fetchERC1155,
  fetchERC1155Balance,
  fetchERC1155Operator,
  fetchERC1155Token,
  replaceURI,
} from "./fetch/erc1155";
import {
  fetchValoremOptionsClearinghouse,
  fetchToken,
  fetchDailyTokenMetrics,
  fetchDailyOCHMetrics,
  handleDailyMetrics,
  RedeemOrTransferAmounts,
  exponentToBigDecimal,
  getTokenPriceUSD,
  ZERO_ADDRESS,
} from "./utils";
import { ERC20 } from "../generated/ValoremOptionsClearinghouse/ERC20";
import { fetchTransaction } from "./fetch/transaction";
import { RoundingMode, roundBigDecimalToBigInt } from "./utils/round";

export function handleNewOptionType(event: NewOptionTypeEvent): void {
  // get params
  const optionId = event.params.optionId.toString();
  const underlyingAddress = event.params.underlyingAsset.toHexString();
  const underlyingAmount = event.params.underlyingAmount;
  const exerciseAddress = event.params.exerciseAsset.toHexString();
  const exerciseAmount = event.params.exerciseAmount;
  const exerciseTimestamp = event.params.exerciseTimestamp;
  const expiryTimestamp = event.params.expiryTimestamp;
  const creatorAddress = event.transaction.from.toHexString();

  // get entities
  const underlyingToken = fetchToken(underlyingAddress);
  const exerciseToken = fetchToken(exerciseAddress);
  const creator = fetchAccount(creatorAddress);

  // initialize new OptionType
  const optionType = new OptionType(optionId);
  optionType.creator = creator.id;
  optionType.createTx = fetchTransaction(event).id;
  optionType.exerciseTimestamp = exerciseTimestamp;
  optionType.expiryTimestamp = expiryTimestamp;
  optionType.underlyingAsset = underlyingToken.id;
  optionType.underlyingAmount = underlyingAmount;
  optionType.exerciseAsset = exerciseToken.id;
  optionType.exerciseAmount = exerciseAmount;
  optionType.amountWritten = BigInt.fromI32(0);
  optionType.amountExercised = BigInt.fromI32(0);
  optionType.save();
}

export function handleOptionsWritten(event: OptionsWrittenEvent): void {
  // get params
  const optionId = event.params.optionId.toString();
  const claimId = event.params.claimId.toString();
  const numberOfOptions = event.params.amount;
  const writerAddress = event.params.writer.toHexString();

  // get entities
  const optionType = OptionType.load(optionId)!;
  const underlyingToken = fetchToken(optionType.underlyingAsset);
  const writer = fetchAccount(writerAddress);

  // update entities
  const claim = fetchClaim(claimId, optionId, writer.id, event);
  claim.amountWritten = claim.amountWritten.plus(numberOfOptions);
  claim.save();
  optionType.amountWritten = optionType.amountWritten.plus(numberOfOptions);
  optionType.save();

  // update token TVL
  const underlyingAmtTotal = optionType.underlyingAmount.times(numberOfOptions);
  underlyingToken.totalValueLocked = underlyingToken.totalValueLocked.plus(
    underlyingAmtTotal
  );
  underlyingToken.save();

  // update metrics
  handleDailyMetrics(
    "write",
    event.block.timestamp,
    optionType,
    numberOfOptions,
    event.address.toHexString(),
    null
  );
}

export function handleBucketWrittenInto(event: BucketWrittenIntoEvent): void {
  // get params
  const optionId = event.params.optionId.toString();
  const claimId = event.params.claimId.toString();
  const bucketIndex = event.params.bucketIndex;
  const numberOfOptions = event.params.amount;

  // get and update Bucket
  const bucket = fetchBucket(optionId, bucketIndex, claimId);
  const newAmountWritten = bucket.amountWritten.plus(numberOfOptions);
  bucket.amountWritten = newAmountWritten;
  bucket.save();
}

export function handleOptionsExercised(event: OptionsExercisedEvent): void {
  // get params
  const optionId = event.params.optionId.toString();
  const numberOfOptions = event.params.amount;

  // get entities
  const optionType = OptionType.load(optionId)!;
  const underlyingToken = fetchToken(optionType.underlyingAsset);
  const exerciseToken = fetchToken(optionType.exerciseAsset);

  // update OptionType (Bucket.amountExercised updated in handleBucketAssignedExercise)
  optionType.amountExercised = optionType.amountExercised.plus(numberOfOptions);
  optionType.save();

  // update tokens' TVL
  const underlyingAmtTotal = optionType.underlyingAmount.times(numberOfOptions);
  const exerciseAmtTotal = optionType.exerciseAmount.times(numberOfOptions);

  underlyingToken.totalValueLocked = underlyingToken.totalValueLocked.minus(
    underlyingAmtTotal
  );
  exerciseToken.totalValueLocked = exerciseToken.totalValueLocked.plus(
    exerciseAmtTotal
  );

  underlyingToken.save();
  exerciseToken.save();

  // update metrics
  handleDailyMetrics(
    "exercise",
    event.block.timestamp,
    optionType,
    numberOfOptions,
    event.address.toHexString(),
    null
  );
}

export function handleBucketAssignedExercise(
  event: BucketAssignedExerciseEvent
): void {
  // get params
  const optionId = event.params.optionId.toString();
  const bucketIndex = event.params.bucketIndex;
  const bucketId = optionId.concat("-").concat(bucketIndex.toString());
  const amountAssigned = event.params.amountAssigned;
  // get entities
  const optionType = OptionType.load(optionId)!;
  const bucket = Bucket.load(bucketId)!;

  // calculate ratio of options exercised in this transaction to bucket's total options written
  const exercisedRatio = amountAssigned.divDecimal(
    bucket.amountWritten.toBigDecimal()
  );

  // update Bucket (optionType.amountExercised updated in handleOptionsExercised)
  bucket.amountExercised = bucket.amountExercised.plus(amountAssigned);
  bucket.save();

  if (bucket.amountExercised.gt(bucket.amountWritten)) {
    log.error("Bucket has more options exercised than written. BucketId: {}", [
      bucket.id,
    ]);
  }

  let allocatedAmount = amountAssigned.toBigDecimal(); // will always be an integer-only value

  const bIdSig = `BucketID:${bucket.id}`;
  const percentOfString = `${exercisedRatio
    .times(BigDecimal.fromString("100"))
    .toString()}% of the bucket's ${bucket.amountWritten.toString()} total options written.`;
  const exerciseString = `Allocated exercises to distribute in bucket: ${allocatedAmount.toString()}; `;
  log.info("Updating bucket assigned claim(s). {} --- {} --- {}", [
    percentOfString,
    exerciseString,
    bIdSig,
  ]);
  for (let i = 0; i < bucket.claims.length; ++i) {
    const claimId = bucket.claims[i];
    const claim = Claim.load(claimId)!;
    const logSignature = `Updating claim #${(
      i + 1
    ).toString()}/${bucket.claims.length.toString()} --- BucketID:${
      bucket.id
    }; ClaimID:${claim.id}`;
    const optionsWritten = claim.amountWritten.toBigDecimal();
    const numClaimOptionsExercised = optionsWritten.times(exercisedRatio);
    // round to nearest integer
    let rounded = roundBigDecimalToBigInt(numClaimOptionsExercised);
    let newAmountExercised: BigInt = BigInt.fromI32(0);

    if (i === bucket.claims.length - 1) {
      // last claim in bucket so use all remaining allocatedAmount
      if (numClaimOptionsExercised.toString() !== allocatedAmount.toString()) {
        rounded = roundBigDecimalToBigInt(allocatedAmount, RoundingMode.UP);
        newAmountExercised = claim.amountExercised.plus(rounded);
        claim.amountExercised = newAmountExercised;
        claim.save();
      }
    } else {
      newAmountExercised = claim.amountExercised.plus(rounded);
      claim.amountExercised = newAmountExercised;
      claim.save();
    }
    allocatedAmount = allocatedAmount.minus(rounded.toBigDecimal());

    log.info(
      "'Exact' amount exercised (%wise): {} --- Rounded (& applied): {} --- Claim.amountExercised: {} --- {}",
      [
        numClaimOptionsExercised.toString(),
        rounded.toString(),
        claim.amountExercised.toString(),
        logSignature,
      ]
    );

    if (claim.amountExercised > claim.amountWritten) {
      log.error(
        "Allocation Error: Claim has more options exercised than written. ClaimID: {}",
        [claimId]
      );
    }
    if (claim.amountExercised < BigInt.fromI32(0)) {
      log.error("Allocation Error: Claim has negative amount exercised", [
        claimId,
      ]);
    }
  }

  if (allocatedAmount.toString() != "0") {
    log.error(
      "Allocation Error: {} allocated amount remaining after distribution",
      [allocatedAmount.toString()]
    );
  }
}

export function handleClaimRedeemed(event: ClaimRedeemedEvent): void {
  // get params
  const optionId = event.params.optionId.toString();
  const claimId = event.params.claimId.toString();
  const underlyingAmountRedeemed = event.params.underlyingAmountRedeemed;
  const exerciseAmountRedeemed = event.params.exerciseAmountRedeemed;
  const redeemerAddress = event.params.redeemer.toHexString();

  // get entities
  const optionType = OptionType.load(optionId)!;
  const claim = Claim.load(claimId)!;
  const underlyingToken = fetchToken(optionType.underlyingAsset);
  const exerciseToken = fetchToken(optionType.exerciseAsset);
  const redeemer = fetchAccount(redeemerAddress);

  // update claim
  claim.redeemed = true;
  claim.redeemer = redeemer.id;
  claim.redeemTx = fetchTransaction(event).id;
  claim.save();

  // update tokens' TVL
  underlyingToken.totalValueLocked = underlyingToken.totalValueLocked.minus(
    underlyingAmountRedeemed
  );

  exerciseToken.totalValueLocked = exerciseToken.totalValueLocked.minus(
    exerciseAmountRedeemed
  );

  underlyingToken.save();
  exerciseToken.save();

  let redeemAmounts = new RedeemOrTransferAmounts();
  redeemAmounts.underlyingAmountTotal = underlyingAmountRedeemed;
  redeemAmounts.exerciseAmountTotal = exerciseAmountRedeemed;

  // update metrics
  handleDailyMetrics(
    "redeem",
    event.block.timestamp,
    optionType,
    BigInt.fromI32(0),
    event.address.toHexString(),
    redeemAmounts
  );
}

export function handleFeeSwitchUpdated(event: FeeSwitchUpdatedEvent): void {
  let isEnabled = event.params.enabled;
  let feeTo = event.params.feeTo.toHexString();

  let feeSwitch = fetchValoremOptionsClearinghouse(event.address.toHexString());
  feeSwitch.feesEnabled = isEnabled;
  feeSwitch.feeToAddress = feeTo;
  feeSwitch.save();
}

export function handleFeeToUpdated(event: FeeToUpdatedEvent): void {
  let newFeeTo = event.params.newFeeTo.toHexString();

  let feeSwitch = fetchValoremOptionsClearinghouse(event.address.toHexString());
  feeSwitch.feeToAddress = newFeeTo;
  feeSwitch.save();
}

export function handleFeeAccrued(event: FeeAccruedEvent): void {
  // get params
  let assetDecimals = BigInt.fromI64(ERC20.bind(event.params.asset).decimals());
  let formattedAmount = event.params.amount
    .toBigDecimal()
    .div(exponentToBigDecimal(assetDecimals));

  // get market prices
  let assetPrice = getTokenPriceUSD(event.params.asset.toHexString());
  let feeValueUSD = assetPrice.times(formattedAmount);

  // update token entity
  const token = fetchToken(event.params.asset.toHexString());
  token.feeBalance = token.feeBalance.plus(event.params.amount);
  token.save();

  // update daily metrics
  const tokenDaily = fetchDailyTokenMetrics(
    event.params.asset.toHexString(),
    event.block.timestamp,
    event.address.toHexString()
  );
  tokenDaily.volFeesAccrued = tokenDaily.volFeesAccrued.plus(
    event.params.amount
  );
  tokenDaily.volFeesAccruedUSD = tokenDaily.volFeesAccruedUSD.plus(feeValueUSD);
  tokenDaily.save();

  const dailyOCHMetrics = fetchDailyOCHMetrics(
    event.block.timestamp,
    event.address.toHexString()
  );
  dailyOCHMetrics.volFeesAccruedUSD = dailyOCHMetrics.volFeesAccruedUSD.plus(
    feeValueUSD
  );
  dailyOCHMetrics.save();
}

export function handleFeeSwept(event: FeeSweptEvent): void {
  // get params
  let assetDecimals = BigInt.fromI64(ERC20.bind(event.params.asset).decimals());
  let formattedAmount = event.params.amount
    .toBigDecimal()
    .div(exponentToBigDecimal(assetDecimals));

  // get market prices
  let assetPrice = getTokenPriceUSD(event.params.asset.toHexString());
  let feeValueUSD = assetPrice.times(formattedAmount);

  // update token entity
  const token = fetchToken(event.params.asset.toHexString());
  token.feeBalance = token.feeBalance.minus(event.params.amount);
  token.save();

  // handle daily metrics
  const tokenDaily = fetchDailyTokenMetrics(
    event.params.asset.toHexString(),
    event.block.timestamp,
    event.address.toHexString()
  );
  tokenDaily.volFeesSwept = tokenDaily.volFeesSwept.plus(event.params.amount);
  tokenDaily.volFeesSweptUSD = tokenDaily.volFeesSweptUSD.plus(feeValueUSD);
  tokenDaily.save();

  const dailyOCHMetrics = fetchDailyOCHMetrics(
    event.block.timestamp,
    event.address.toHexString()
  );
  dailyOCHMetrics.volFeesSweptUSD = dailyOCHMetrics.volFeesSweptUSD.plus(
    feeValueUSD
  );
  dailyOCHMetrics.save();
}

// checks if transfer is an OCH Write/Exercise/Redeem event (mint/burn)
function isMintOrBurn(from: string, to: string): boolean {
  return from == ZERO_ADDRESS || to == ZERO_ADDRESS;
}

/**
 * Updates daily metrics when ERC-1155 Tokens are transferred
 * Requires that the to/from addresses are not the Zero Address
 */
function handleERC1155TransferMetrics(
  tokenId: BigInt,
  amount: BigInt,
  fromAddress: string,
  toAddress: string,
  eventAddress: string,
  eventTimestamp: BigInt
): void {
  if (!isMintOrBurn(fromAddress, toAddress)) {
    // bind to ValoremOptionsClearinghouse to call view functions
    const och = OCHContract.bind(Address.fromString(eventAddress));

    // get type of Token
    const tokenType = och.tokenType(tokenId);

    // load entities for calculating metrics
    const optionType = OptionType.load(tokenId.toString())!;

    let transferAmounts = new RedeemOrTransferAmounts();

    // if option was transferred only update underlying token's metrics
    // if claim was transferred update underlying and exercise tokens' metrics
    if (tokenType == 1) {
      const underlyingAmountTotal = optionType.underlyingAmount.times(amount);
      transferAmounts.underlyingAmountTotal = underlyingAmountTotal;
    } else if (tokenType == 2) {
      // get ratio of corresponding options written/exercised
      const claimStruct = och.claim(tokenId);
      const amountWritten = claimStruct.amountWritten;
      const amountExercised = claimStruct.amountExercised;

      transferAmounts.underlyingAmountTotal = optionType.underlyingAmount.times(
        amountWritten.minus(amountExercised)
      );

      transferAmounts.exerciseAmountTotal = optionType.exerciseAmount.times(
        amountExercised
      );
    }

    // update metrics
    handleDailyMetrics(
      "transfer",
      eventTimestamp,
      optionType,
      BigInt.fromI32(1),
      eventAddress,
      transferAmounts
    );
  }
}

/**
 * The following code is credited to https://github.com/OpenZeppelin/openzeppelin-subgraphs
 * Included under MIT License
 * Extended to support Valorem
 */

export function handleTransferSingle(event: TransferSingleEvent): void {
  let contract = fetchERC1155(event.address.toHexString());
  let operator = fetchAccount(event.params.operator.toHexString());
  let from = fetchAccount(event.params.from.toHexString());
  let to = fetchAccount(event.params.to.toHexString());

  registerTransfer(
    event,
    "",
    contract,
    operator,
    from,
    to,
    event.params.id,
    event.params.amount
  );

  // Valorem
  handleERC1155TransferMetrics(
    event.params.id,
    event.params.amount,
    from.id,
    to.id,
    event.address.toHexString(),
    event.block.timestamp
  );
}

export function handleTransferBatch(event: TransferBatchEvent): void {
  const contract = fetchERC1155(event.address.toHexString());
  const operator = fetchAccount(event.params.operator.toHexString());
  const from = fetchAccount(event.params.from.toHexString());
  const to = fetchAccount(event.params.to.toHexString());
  const ids = event.params.ids;
  const amounts = event.params.amounts;

  if (ids.length == amounts.length) {
    for (let i = 0; i < ids.length; ++i) {
      registerTransfer(
        event,
        "/".concat(i.toString()),
        contract,
        operator,
        from,
        to,
        ids[i],
        amounts[i]
      );

      // Valorem
      handleERC1155TransferMetrics(
        ids[i],
        amounts[i],
        from.id,
        to.id,
        event.address.toHexString(),
        event.block.timestamp
      );
    }
  }
}

export function handleApprovalForAll(event: ApprovalForAllEvent): void {
  let contract = fetchERC1155(event.address.toHexString());
  let owner = fetchAccount(event.params.owner.toHexString());
  let operator = fetchAccount(event.params.operator.toHexString());
  let delegation = fetchERC1155Operator(contract, owner, operator);
  delegation.approved = event.params.approved;
  delegation.save();
}

export function handleURI(event: URIEvent): void {
  let contract = fetchERC1155(event.address.toHexString());
  let token = fetchERC1155Token(contract, event.params.id);
  token.uri = replaceURI(event.params.value, event.params.id);
  token.save();
}

function registerTransfer(
  event: ethereum.Event,
  suffix: string,
  contract: ERC1155Contract,
  operator: Account,
  from: Account,
  to: Account,
  id: BigInt,
  value: BigInt
): void {
  let token = fetchERC1155Token(contract, id);
  let ev = new ERC1155Transfer(
    event.block.number
      .toString()
      .concat("-")
      .concat(event.logIndex.toString())
      .concat(suffix)
  );
  ev.emitter = token.contract;
  ev.transaction = event.block.number
    .toString()
    .concat("-")
    .concat(event.logIndex.toString());
  ev.timestamp = event.block.timestamp;
  ev.contract = contract.id;
  ev.token = token.id;
  ev.operator = operator.id;
  ev.value = value.toBigDecimal();
  ev.valueExact = value;

  if (from.id == Address.zero().toHexString()) {
    let totalSupply = fetchERC1155Balance(token, null);
    totalSupply.valueExact = totalSupply.valueExact.plus(value);
    totalSupply.value = totalSupply.valueExact.toBigDecimal();
    totalSupply.save();
  } else {
    let balance = fetchERC1155Balance(token, from);
    balance.valueExact = balance.valueExact.minus(value);
    balance.value = balance.valueExact.toBigDecimal();
    balance.save();

    ev.from = from.id;
    ev.fromBalance = balance.id;
  }

  if (to.id == Address.zero().toHexString()) {
    let totalSupply = fetchERC1155Balance(token, null);
    totalSupply.valueExact = totalSupply.valueExact.minus(value);
    totalSupply.value = totalSupply.valueExact.toBigDecimal();
    totalSupply.save();
  } else {
    let balance = fetchERC1155Balance(token, to);
    balance.valueExact = balance.valueExact.plus(value);
    balance.value = balance.valueExact.toBigDecimal();
    balance.save();

    ev.to = to.id;
    ev.toBalance = balance.id;
  }

  token.save();
  ev.save();

  // Valorem: Set the token type and relation of ERC-1155 Tokens on mint
  if (!token.optionType && !token.claim) {
    // bind to ValoremOptionsClearinghouse to call view functions
    const och = OCHContract.bind(Address.fromBytes(event.address));
    // get type of Token
    const tokenType = och.tokenType(id);

    if (tokenType == 1) {
      // option transfer
      token.type = 1;
      token.optionType = id.toString();
    } else if (tokenType == 2) {
      // claim transfer
      token.type = 2;
      token.claim = id.toString();
    }

    token.save();
  }
}
