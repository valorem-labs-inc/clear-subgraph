import { Address, BigInt, ethereum, log } from "@graphprotocol/graph-ts";

import {
  OptionType,
  Claim,
  Account,
  ERC1155Contract,
  ERC1155Transfer,
} from "../generated/schema";

import {
  OptionSettlementEngine as OSEContract,
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

import { fetchAccount } from "./fetch/account";
import {
  fetchERC1155,
  fetchERC1155Balance,
  fetchERC1155Operator,
  fetchERC1155Token,
  replaceURI,
} from "./fetch/erc1155";

import {
  fetchOptionSettlementEngine,
  fetchToken,
  fetchDailyTokenMetrics,
  fetchDailyOSEMetrics,
  handleDailyMetrics,
  RedeemOrTransferAmounts,
  exponentToBigDecimal,
  getTokenPriceUSD,
  ZERO_ADDRESS,
} from "./utils";

import { ERC20 } from "../generated/OptionSettlementEngine/ERC20";

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

  // get entities
  const underlyingToken = fetchToken(underlyingAddress);
  const exerciseToken = fetchToken(exerciseAddress);
  const creator = fetchAccount(creatorAddress);

  // initialize new OptionType
  const optionType = new OptionType(optionId);
  optionType.creator = creator.id;
  optionType.createTx = txHash;
  optionType.exerciseTimestamp = exerciseTimestamp;
  optionType.expiryTimestamp = expiryTimestamp;
  optionType.underlyingAsset = underlyingToken.id;
  optionType.underlyingAmount = underlyingAmount;
  optionType.exerciseAsset = exerciseToken.id;
  optionType.exerciseAmount = exerciseAmount;
  optionType.amountWritten = BigInt.fromI32(0);
  optionType.claims = new Array<string>();
  optionType.save();
}

export function handleOptionsWritten(event: OptionsWrittenEvent): void {
  // get params
  const optionId = event.params.optionId.toString();
  const claimId = event.params.claimId.toString();
  const numberOfOptions = event.params.amount;
  const writerAddress = event.params.writer.toHexString();
  const txHash = event.transaction.hash.toHexString();

  // get entities
  const optionType = OptionType.load(optionId)!;
  const underlyingToken = fetchToken(optionType.underlyingAsset);
  const writer = fetchAccount(writerAddress);

  // initialize new Claim
  const claim = new Claim(claimId);
  claim.writer = writer.id;
  claim.writeTx = txHash;
  claim.amountWritten = numberOfOptions;
  claim.redeemed = false;
  claim.optionType = optionType.id;
  claim.save();

  // add this claim to OptionType's claim pointer
  const claimsWritten = optionType.claims;
  claimsWritten.push(claimId);
  optionType.claims = claimsWritten;
  optionType.amountWritten = optionType.amountWritten.plus(numberOfOptions);
  optionType.save();

  // update token TVL
  const underlyingAmtTotal = optionType.underlyingAmount.times(numberOfOptions);
  underlyingToken.totalValueLocked = underlyingToken.totalValueLocked.plus(
    underlyingAmtTotal
  );
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

  // get entities
  const optionType = OptionType.load(optionId)!;
  const underlyingToken = fetchToken(optionType.underlyingAsset);
  const exerciseToken = fetchToken(optionType.exerciseAsset);

  // update OptionType
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
  const exerciseToken = fetchToken(optionType.exerciseAsset);
  const redeemer = fetchAccount(redeemerAddress);

  // update claim
  claim.redeemed = true;
  claim.redeemer = redeemer.id;
  claim.redeemTx = txHash;
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

  const token = fetchToken(event.params.asset.toHexString());
  token.feeBalance = token.feeBalance.plus(event.params.amount);
  token.save();

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

  const token = fetchToken(event.params.asset.toHexString());
  token.feeBalance = token.feeBalance.minus(event.params.amount);
  token.save();

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

// https://github.com/OpenZeppelin/openzeppelin-subgraphs
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

  /**
   * Valorem Extension
   */
  // get params
  const fromAddress = event.params.from.toHexString();
  const toAddress = event.params.to.toHexString();
  const tokenId = event.params.id;
  const amount = event.params.amount;

  // check transfer isn't an OSE Write/Exercise/Redeem event (mint/OSE is receiver/burn)
  const transferIsExternal =
    fromAddress != ZERO_ADDRESS &&
    toAddress != ZERO_ADDRESS &&
    toAddress != event.address.toHexString();

  if (transferIsExternal) {
    // bind to OptionSettlementEngine to call view functions
    const ose = OSEContract.bind(Address.fromBytes(event.address));
    // get type of Token
    const tokenType = ose.tokenType(tokenId);

    handleERC1155TransferMetrics(tokenId, amount, event, tokenType);
  }
}

// https://github.com/OpenZeppelin/openzeppelin-subgraphs
export function handleTransferBatch(event: TransferBatchEvent): void {
  const contract = fetchERC1155(event.address.toHexString());
  const operator = fetchAccount(event.params.operator.toHexString());
  const from = fetchAccount(event.params.from.toHexString());
  const to = fetchAccount(event.params.to.toHexString());
  const ids = event.params.ids;
  const amounts = event.params.amounts;
  // If this equality doesn't hold (some devs actually don't follow the ERC specifications) then we just can't make
  // sens of what is happening. Don't try to make something out of stupid code, and just throw the event. This
  // contract doesn't follow the standard anyway.
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
    }
  }

  /**
   * Valorem Extension
   */
  // get params
  const fromAddress = event.params.from.toHexString();
  const toAddress = event.params.to.toHexString();

  // check transfer isn't an OSE Write/Exercise/Redeem event (mint/OSE is receiver/burn)
  const transferIsExternal =
    fromAddress != ZERO_ADDRESS &&
    toAddress != ZERO_ADDRESS &&
    toAddress != event.address.toHexString();

  if (transferIsExternal) {
    // bind to OptionSettlementEngine to call view functions
    const ose = OSEContract.bind(Address.fromBytes(event.address));

    // iterate through batch
    for (let i = 0; i < ids.length; i++) {
      const tokenId = ids[i];
      const amount = amounts[i];

      // get type of Token
      const tokenType = ose.tokenType(ids[i]);

      handleERC1155TransferMetrics(tokenId, amount, event, tokenType);
    }
  }
}

// Valorem Specific
function handleERC1155TransferMetrics(
  tokenId: BigInt,
  amount: BigInt,
  event: ethereum.Event,
  tokenType: number
): void {
  // load entities for calculating metrics
  const optionType = OptionType.load(tokenId.toString())!;

  let transferAmounts = new RedeemOrTransferAmounts();

  // if option was transferred only update underlying token's metrics
  if (tokenType == 1) {
    const underlyingAmountTotal = optionType.underlyingAmount.times(amount);
    transferAmounts.underlyingAmountTotal = underlyingAmountTotal;
  }

  // if claim was transferred update underlying and exercise tokens' metrics
  if (tokenType == 2) {
    // get ratio of corresponding options written/exercised
    const ose = OSEContract.bind(Address.fromBytes(event.address));
    const claimStruct = ose.claim(tokenId);
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
    event.block.timestamp,
    optionType,
    BigInt.fromI32(1),
    transferAmounts
  );
}

// https://github.com/OpenZeppelin/openzeppelin-subgraphs
export function handleApprovalForAll(event: ApprovalForAllEvent): void {
  let contract = fetchERC1155(event.address.toHexString());
  let owner = fetchAccount(event.params.owner.toHexString());
  let operator = fetchAccount(event.params.operator.toHexString());
  let delegation = fetchERC1155Operator(contract, owner, operator);
  delegation.approved = event.params.approved;
  delegation.save();
}

// https://github.com/OpenZeppelin/openzeppelin-subgraphs
export function handleURI(event: URIEvent): void {
  let contract = fetchERC1155(event.address.toHexString());
  let token = fetchERC1155Token(contract, event.params.id);
  token.uri = replaceURI(event.params.value, event.params.id);
  token.save();
}

// https://github.com/OpenZeppelin/openzeppelin-subgraphs
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

  /**
   * Valorem Extension
   */
  if (!token.optionType && !token.claim) {
    // bind to OptionSettlementEngine to call view functions
    const ose = OSEContract.bind(Address.fromBytes(event.address));
    // get type of Token
    const tokenType = ose.tokenType(id);

    // option transfer
    if (tokenType == 1) {
      token.type = 1;
      token.optionType = id.toString();
    }
    // claim transfer
    if (tokenType == 2) {
      token.type = 2;
      token.claim = id.toString();
    }

    token.save();
  }
}
