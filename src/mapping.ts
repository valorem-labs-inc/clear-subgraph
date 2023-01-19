import {
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
} from "../generated/OptionSettlementEngine/OptionSettlementEngine";
import { OptionType, Option, Claim } from "../generated/schema";
import { exponentToBigDecimal, getTokenPriceUSD } from "./utils/price";
import { ERC20 } from "../generated/OptionSettlementEngine/ERC20";
import {
  fetchOptionSettlementEngine,
  fetchToken,
  fetchTransaction,
  fetchAccount,
  checkForDuplicateTransferSingleOrBatch,
  fetchDailyTokenMetrics,
  fetchDailyOSEMetrics,
} from "./utils";
import { BigInt, log } from "@graphprotocol/graph-ts";
import { ZERO_ADDRESS } from "./utils/constants";

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
  const txHash = event.transaction.hash.toHexString();

  // Delete any ERC1155 transfers that were created in the same txHash
  const tx = checkForDuplicateTransferSingleOrBatch(txHash);

  // get entities
  const underlyingToken = fetchToken(underlyingAddress);
  const exerciseToken = fetchToken(exerciseAddress);
  const creator = fetchAccount(creatorAddress);

  // initialize new OptionType
  const optionType = new OptionType(optionId);
  optionType.creator = creator.id;
  optionType.createdTx = txHash;
  optionType.exerciseTimestamp = exerciseTimestamp;
  optionType.expiryTimestamp = expiryTimestamp;
  optionType.underlyingAsset = underlyingToken.id;
  optionType.underlyingAmount = underlyingAmount;
  optionType.exerciseAsset = exerciseToken.id;
  optionType.exerciseAmount = exerciseAmount;
  optionType.optionSupply = BigInt.fromI32(0);
  optionType.save();
}

export function handleOptionsWritten(event: OptionsWrittenEvent): void {
  // get params
  const optionId = event.params.optionId.toString();
  const claimId = event.params.claimId.toString();
  const numberOfOptions = event.params.amount;
  const writerAddress = event.params.writer.toHexString();
  const txHash = event.transaction.hash.toHexString();

  // Delete any ERC1155 transfers that were created in the same txHash
  const tx = checkForDuplicateTransferSingleOrBatch(txHash);

  // get entities
  const optionType = OptionType.load(optionId)!;
  const underlyingToken = fetchToken(optionType.underlyingAsset);
  const writer = fetchAccount(writerAddress);

  // initialize new Claim
  const claim = new Claim(claimId);
  claim.writer = writer.id;
  claim.createdTx = tx.id;
  claim.optionsWritten = numberOfOptions;
  claim.optionsExercised = BigInt.fromI32(0);
  claim.redeemed = false;
  claim.owner = writer.id;
  claim.save();

  // initialize new Option(s)
  for (let i = 0; i < numberOfOptions.toI32(); i++) {
    // update OptionType Supply
    optionType.optionSupply = optionType.optionSupply.plus(BigInt.fromI32(1));
    optionType.save();

    const option = new Option(`${optionId}-${optionType.optionSupply}`);
    option.writer = writer.id;
    option.createdTx = tx.id;
    option.exercised = false;
    option.owner = writer.id;
    option.optionType = optionType.id;
    option.claim = claim.id;
    option.save();

    let writerOptionIDsOwned = writer.optionIDsOwned;
    writerOptionIDsOwned.push(`${option.id}`);
    writer.optionIDsOwned = writerOptionIDsOwned;
    writer.save();
  }

  // get asset market prices
  const underlyingPriceUSD = getTokenPriceUSD(underlyingToken.id);
  const underlyingAmtTotal = optionType.underlyingAmount.times(numberOfOptions);
  const underlyingTotalUSD = underlyingPriceUSD.times(
    underlyingAmtTotal.toBigDecimal()
  );

  // update token TVL
  underlyingToken.tvl = underlyingToken.tvl.plus(underlyingAmtTotal);
  underlyingToken.save();

  // update token metrics
  const underlyingDaily = fetchDailyTokenMetrics(
    underlyingToken.id,
    event.block.timestamp
  );
  underlyingDaily.tvl = underlyingDaily.tvl.plus(underlyingAmtTotal);
  underlyingDaily.notionalVolWritten = underlyingDaily.notionalVolWritten.plus(
    underlyingAmtTotal
  );
  underlyingDaily.notionalVolSettled = underlyingDaily.notionalVolSettled.plus(
    underlyingAmtTotal
  );
  underlyingDaily.notionalVolSum = underlyingDaily.notionalVolSum.plus(
    underlyingAmtTotal
  );
  underlyingDaily.notionalVolWrittenUSD = underlyingDaily.notionalVolWrittenUSD.plus(
    underlyingTotalUSD
  );
  underlyingDaily.notionalVolSettledUSD = underlyingDaily.notionalVolSettledUSD.plus(
    underlyingTotalUSD
  );
  underlyingDaily.notionalVolSumUSD = underlyingDaily.notionalVolSumUSD.plus(
    underlyingTotalUSD
  );
  underlyingDaily.save();

  // update OSE metrics
  const dailyOSEMetrics = fetchDailyOSEMetrics(event.block.timestamp);
  dailyOSEMetrics.notionalVolWrittenUSD = dailyOSEMetrics.notionalVolWrittenUSD.plus(
    underlyingTotalUSD
  );
  dailyOSEMetrics.notionalVolSettledUSD = dailyOSEMetrics.notionalVolSettledUSD.plus(
    underlyingTotalUSD
  );
  dailyOSEMetrics.notionalVolSumUSD = dailyOSEMetrics.notionalVolSumUSD.plus(
    underlyingTotalUSD
  );
  dailyOSEMetrics.save();
}

export function handleOptionsExercised(event: OptionsExercisedEvent): void {
  // get params
  const optionId = event.params.optionId.toString();
  const numberOfOptions = event.params.amount;
  const exerciserAddress = event.params.exerciser.toHexString();
  const txHash = event.transaction.hash.toHexString();

  // get entities
  const optionType = OptionType.load(optionId)!;
  const underlyingToken = fetchToken(optionType.underlyingAsset);
  const exerciseToken = fetchToken(optionType.underlyingAsset);
  const exerciser = fetchAccount(exerciserAddress);

  // Delete any ERC1155 transfers that were created in the same txHash
  const tx = checkForDuplicateTransferSingleOrBatch(txHash);

  // update options and claims
  const exerciserOwnedOptions = exerciser.optionIDsOwned;

  const filteredOptions: Option[] = [];
  for (let i = 0; i < exerciserOwnedOptions.length; i++) {
    if (exerciserOwnedOptions[i].includes(optionId)) {
      filteredOptions.push(Option.load(exerciserOwnedOptions[i])!);
    }
  }

  for (let i = 0; i < numberOfOptions.toI32(); i++) {
    const option = Option.load(filteredOptions[i].id)!;
    option.exercised = true;
    option.exerciser = exerciser.id;
    option.exerciseTx = tx.id;
    option.save();
    const claim = Claim.load(option.claim)!;
    claim.optionsExercised = claim.optionsExercised.plus(BigInt.fromI32(1));
    claim.save();

    const exerciserOptionIDsOwned = exerciser.optionIDsOwned;
    const optionIndex = exerciserOptionIDsOwned.indexOf(`${option.id}`);
    const slicedArrStart = exerciserOptionIDsOwned.slice(0, optionIndex);
    const slicedArrEnd = exerciserOptionIDsOwned.slice(optionIndex + 1);
    const updatedArray = [slicedArrStart, slicedArrEnd].flat();
    exerciser.optionIDsOwned = updatedArray;
    exerciser.save();
  }

  // get asset market prices
  const underlyingPriceUSD = getTokenPriceUSD(underlyingToken.id);
  const underlyingAmtTotal = optionType.underlyingAmount.times(numberOfOptions);
  const underlyingTotalUSD = underlyingPriceUSD.times(
    underlyingAmtTotal.toBigDecimal()
  );

  const exercisePriceUSD = getTokenPriceUSD(exerciseToken.id);
  const exerciseAmtTotal = optionType.exerciseAmount.times(numberOfOptions);
  const exerciseTotalUSD = exercisePriceUSD.times(
    exerciseAmtTotal.toBigDecimal()
  );

  // update tokens TVL
  underlyingToken.tvl = underlyingToken.tvl.minus(underlyingAmtTotal);
  underlyingToken.save();
  exerciseToken.tvl = exerciseToken.tvl.plus(exerciseAmtTotal);
  exerciseToken.save();

  // update token metrics
  const underlyingDaily = fetchDailyTokenMetrics(
    underlyingToken.id,
    event.block.timestamp
  );
  underlyingDaily.tvl = underlyingDaily.tvl.minus(underlyingAmtTotal);
  underlyingDaily.notionalVolExercised = underlyingDaily.notionalVolExercised.plus(
    underlyingAmtTotal
  );
  underlyingDaily.notionalVolSettled = underlyingDaily.notionalVolSettled.plus(
    underlyingAmtTotal
  );
  underlyingDaily.notionalVolSum = underlyingDaily.notionalVolSum.plus(
    underlyingAmtTotal
  );
  underlyingDaily.notionalVolExercisedUSD = underlyingDaily.notionalVolExercisedUSD.plus(
    underlyingTotalUSD
  );
  underlyingDaily.notionalVolSettledUSD = underlyingDaily.notionalVolSettledUSD.plus(
    underlyingTotalUSD
  );
  underlyingDaily.notionalVolSumUSD = underlyingDaily.notionalVolSumUSD.plus(
    underlyingTotalUSD
  );
  underlyingDaily.save();

  const exerciseDaily = fetchDailyTokenMetrics(
    exerciseToken.id,
    event.block.timestamp
  );
  exerciseDaily.tvl = exerciseDaily.tvl.plus(exerciseAmtTotal);
  exerciseDaily.notionalVolExercised = exerciseDaily.notionalVolExercised.plus(
    exerciseAmtTotal
  );
  exerciseDaily.notionalVolSettled = exerciseDaily.notionalVolSettled.plus(
    exerciseAmtTotal
  );
  exerciseDaily.notionalVolSum = exerciseDaily.notionalVolSum.plus(
    exerciseAmtTotal
  );
  exerciseDaily.notionalVolExercisedUSD = exerciseDaily.notionalVolExercisedUSD.plus(
    exerciseTotalUSD
  );
  exerciseDaily.notionalVolSettledUSD = exerciseDaily.notionalVolSettledUSD.plus(
    exerciseTotalUSD
  );
  exerciseDaily.notionalVolSumUSD = exerciseDaily.notionalVolSumUSD.plus(
    exerciseTotalUSD
  );
  exerciseDaily.save();

  // update OSE metrics
  const dailyOSEMetrics = fetchDailyOSEMetrics(event.block.timestamp);
  dailyOSEMetrics.notionalVolExercisedUSD = dailyOSEMetrics.notionalVolExercisedUSD.plus(
    underlyingTotalUSD.plus(exerciseTotalUSD)
  );
  dailyOSEMetrics.notionalVolSettledUSD = dailyOSEMetrics.notionalVolSettledUSD.plus(
    underlyingTotalUSD.plus(exerciseTotalUSD)
  );
  dailyOSEMetrics.notionalVolSumUSD = dailyOSEMetrics.notionalVolSumUSD.plus(
    underlyingTotalUSD.plus(exerciseTotalUSD)
  );
  dailyOSEMetrics.save();
}

export function handleClaimRedeemed(event: ClaimRedeemedEvent): void {
  // get params
  const optionId = event.params.optionId.toString();
  const claimId = event.params.claimId.toString();
  const underlyingAmountRedeemed = event.params.underlyingAmountRedeemed;
  const exerciseAmountRedeemed = event.params.exerciseAmountRedeemed;
  const redeemerAddress = event.params.redeemer.toHexString();
  const txHash = event.transaction.hash.toHexString();

  // get entities
  const optionType = OptionType.load(optionId)!;
  const claim = Claim.load(claimId)!;
  const underlyingToken = fetchToken(optionType.underlyingAsset);
  const exerciseToken = fetchToken(optionType.underlyingAsset);
  const redeemer = fetchAccount(redeemerAddress);

  // Delete any ERC1155 transfers that were created in the same txHash
  const tx = checkForDuplicateTransferSingleOrBatch(txHash);

  // update claim
  claim.redeemed = true;
  claim.redeemer = redeemer.id;
  claim.redeemTx = tx.id;
  claim.save();

  // get asset market prices
  const underlyingPriceUSD = getTokenPriceUSD(underlyingToken.id);
  const underlyingTotalUSD = underlyingPriceUSD.times(
    underlyingAmountRedeemed.toBigDecimal()
  );

  const exercisePriceUSD = getTokenPriceUSD(exerciseToken.id);
  const exerciseTotalUSD = exercisePriceUSD.times(
    exerciseAmountRedeemed.toBigDecimal()
  );

  // update tokens TVL
  underlyingToken.tvl = underlyingToken.tvl.minus(underlyingAmountRedeemed);
  underlyingToken.save();
  exerciseToken.tvl = exerciseToken.tvl.minus(exerciseAmountRedeemed);
  exerciseToken.save();

  // update token metrics
  const underlyingDaily = fetchDailyTokenMetrics(
    underlyingToken.id,
    event.block.timestamp
  );
  underlyingDaily.tvl = underlyingDaily.tvl.minus(underlyingAmountRedeemed);
  underlyingDaily.notionalVolRedeemed = underlyingDaily.notionalVolRedeemed.plus(
    underlyingAmountRedeemed
  );
  underlyingDaily.notionalVolSum = underlyingDaily.notionalVolSum.plus(
    underlyingAmountRedeemed
  );
  underlyingDaily.notionalVolRedeemedUSD = underlyingDaily.notionalVolRedeemedUSD.plus(
    underlyingTotalUSD
  );
  underlyingDaily.notionalVolSumUSD = underlyingDaily.notionalVolSumUSD.plus(
    underlyingTotalUSD
  );
  underlyingDaily.save();

  const exerciseDaily = fetchDailyTokenMetrics(
    exerciseToken.id,
    event.block.timestamp
  );
  exerciseDaily.tvl = exerciseDaily.tvl.plus(exerciseAmountRedeemed);
  exerciseDaily.notionalVolExercised = exerciseDaily.notionalVolExercised.plus(
    exerciseAmountRedeemed
  );
  exerciseDaily.notionalVolSettled = exerciseDaily.notionalVolSettled.plus(
    exerciseAmountRedeemed
  );
  exerciseDaily.notionalVolSum = exerciseDaily.notionalVolSum.plus(
    exerciseAmountRedeemed
  );
  exerciseDaily.notionalVolExercisedUSD = exerciseDaily.notionalVolExercisedUSD.plus(
    exerciseTotalUSD
  );
  exerciseDaily.notionalVolSumUSD = exerciseDaily.notionalVolSumUSD.plus(
    exerciseTotalUSD
  );
  exerciseDaily.notionalVolSettledUSD = exerciseDaily.notionalVolSettledUSD.plus(
    exerciseTotalUSD
  );
  exerciseDaily.save();

  // update OSE metrics
  const dailyOSEMetrics = fetchDailyOSEMetrics(event.block.timestamp);
  dailyOSEMetrics.notionalVolExercisedUSD = dailyOSEMetrics.notionalVolExercisedUSD.plus(
    underlyingTotalUSD.plus(exerciseTotalUSD)
  );
  dailyOSEMetrics.notionalVolSettledUSD = dailyOSEMetrics.notionalVolSettledUSD.plus(
    underlyingTotalUSD.plus(exerciseTotalUSD)
  );
  dailyOSEMetrics.notionalVolSumUSD = dailyOSEMetrics.notionalVolSumUSD.plus(
    underlyingTotalUSD.plus(exerciseTotalUSD)
  );
  dailyOSEMetrics.save();
}

export function handleFeeSwitchUpdated(event: FeeSwitchUpdatedEvent): void {
  let isEnabled = event.params.enabled;
  let feeTo = event.params.feeTo.toHexString();

  let feeSwitch = fetchOptionSettlementEngine(event.address.toHexString());
  feeSwitch.feesEnabled = isEnabled;
  feeSwitch.feeToAddress = feeTo;
  feeSwitch.save();
}

export function handleFeeToUpdated(event: FeeToUpdatedEvent): void {
  let newFeeTo = event.params.newFeeTo.toHexString();

  let feeSwitch = fetchOptionSettlementEngine(event.address.toHexString());
  feeSwitch.feeToAddress = newFeeTo;
  feeSwitch.save();
}

export function handleFeeAccrued(event: FeeAccruedEvent): void {
  let assetDecimals = BigInt.fromI64(ERC20.bind(event.params.asset).decimals());
  let formattedAmount = event.params.amount
    .toBigDecimal()
    .div(exponentToBigDecimal(assetDecimals));

  let assetPrice = getTokenPriceUSD(event.params.asset.toHexString());
  let feeValueUSD = assetPrice.times(formattedAmount);

  const tokenDaily = fetchDailyTokenMetrics(
    event.params.asset.toHexString(),
    event.block.timestamp
  );
  tokenDaily.notionalVolFeesAccrued = tokenDaily.notionalVolFeesAccrued.plus(
    event.params.amount
  );
  tokenDaily.notionalVolFeesAccruedUSD = tokenDaily.notionalVolFeesAccruedUSD.plus(
    feeValueUSD
  );
  tokenDaily.save();

  const dailyOSEMetrics = fetchDailyOSEMetrics(event.block.timestamp);
  dailyOSEMetrics.notionalVolFeesAccruedUSD = dailyOSEMetrics.notionalVolFeesAccruedUSD.plus(
    feeValueUSD
  );
  dailyOSEMetrics.save();
}

export function handleFeeSwept(event: FeeSweptEvent): void {
  let assetDecimals = BigInt.fromI64(ERC20.bind(event.params.asset).decimals());
  let formattedAmount = event.params.amount
    .toBigDecimal()
    .div(exponentToBigDecimal(assetDecimals));

  let assetPrice = getTokenPriceUSD(event.params.asset.toHexString());
  let feeValueUSD = assetPrice.times(formattedAmount);

  const tokenDaily = fetchDailyTokenMetrics(
    event.params.asset.toHexString(),
    event.block.timestamp
  );
  tokenDaily.notionalVolFeesSwept = tokenDaily.notionalVolFeesSwept.plus(
    event.params.amount
  );
  tokenDaily.notionalVolFeesSweptUSD = tokenDaily.notionalVolFeesSweptUSD.plus(
    feeValueUSD
  );
  tokenDaily.save();

  const dailyOSEMetrics = fetchDailyOSEMetrics(event.block.timestamp);
  dailyOSEMetrics.notionalVolFeesSweptUSD = dailyOSEMetrics.notionalVolFeesSweptUSD.plus(
    feeValueUSD
  );
  dailyOSEMetrics.save();
}

export function handleTransferSingle(event: TransferSingleEvent): void {
  // check transfer isn't an OSE Write/Exercise/Redeem event
  const fromAddress = event.params.from.toHexString();
  const toAddress = event.params.to.toHexString();
  if (fromAddress == ZERO_ADDRESS || toAddress == ZERO_ADDRESS) {
    return;
  }

  log.warning("unhandled Transfer Single; to:{}, from:{}", [
    toAddress,
    fromAddress,
  ]);

  // try to find option or claim (s), then update their owners
}

export function handleTransferBatch(event: TransferBatchEvent): void {
  // check transfer isn't an OSE Write/Exercise/Redeem event
  const fromAddress = event.params.from.toHexString();
  const toAddress = event.params.to.toHexString();
  if (fromAddress == ZERO_ADDRESS || toAddress == ZERO_ADDRESS) {
    return;
  }

  const optionId = event.params.ids[0];
  const optionQty = event.params.amounts[0];
  const claimId = event.params.ids[1];
  const claimQty = event.params.amounts[1];
  log.warning("unhandled Transfer Batch; to:{}, from:{}", [
    toAddress,
    fromAddress,
  ]);
  // try to find option or claim (s), then update their owners
}

export function handleApprovalForAll(event: ApprovalForAllEvent): void {}

export function handleURI(event: URIEvent): void {
  // let contract = fetchERC1155(event.address);
  // let token = fetchERC1155Token(contract, event.params.id);
  // token.uri = replaceURI(event.params.value, event.params.id);
  // token.save();
}
