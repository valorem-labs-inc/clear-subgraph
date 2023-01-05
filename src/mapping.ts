import { ethereum, BigInt, Address } from "@graphprotocol/graph-ts";

import {
  Account,
  ERC1155Contract,
  ERC1155Transfer,
  Token,
} from "../generated/schema";

import {
  OptionSettlementEngine,
  ApprovalForAll as ApprovalForAllEvent,
  ClaimRedeemed,
  FeeAccrued,
  FeeSwept,
  NewOptionType,
  OptionsExercised,
  OptionsWritten,
  TransferBatch as TransferBatchEvent,
  TransferSingle as TransferSingleEvent,
  URI as URIEvent,
  FeeToUpdated,
  FeeSwitchUpdated,
} from "../generated/OptionSettlementEngine/OptionSettlementEngine";
import { Option, Claim } from "../generated/schema";

import { constants } from "./constants";

import { decimals } from "./decimals";

import { events } from "./events";

import { transactions } from "./transactions";

import { fetchAccount } from "./fetch/account";

import {
  fetchERC1155,
  fetchERC1155Token,
  fetchERC1155Balance,
  fetchERC721Operator,
  replaceURI,
} from "./fetch/erc1155";
import { exponentToBigDecimal, getTokenPriceUSD } from "./utils/price";
import { ZERO_ADDRESS } from "./utils/constants";
import { ERC20 } from "../generated/OptionSettlementEngine/ERC20";
import {
  initializeToken,
  loadOrInitializeFeeSwitch,
  loadOrInitializeToken,
  updateTokenDayData,
  updateValoremDayData,
} from "./utils";

// TODO(Implement these)

export function handleClaimRedeemed(event: ClaimRedeemed): void {
  /**
   * Handle Claim
   */
  let claim = Claim.load(event.params.claimId.toString());

  if (claim == null) {
    claim = new Claim(event.params.claimId.toString());
    claim.save();
  }

  claim.option = event.params.optionId.toString();
  claim.claimed = true;
  claim.claimant = fetchAccount(event.params.redeemer).id;
  claim.exerciseAmount = event.params.exerciseAmountRedeemed;
  claim.underlyingAmount = event.params.underlyingAmountRedeemed;

  claim.save();

  /**
   * Handle Exercise Asset
   * retrieve value of exercise assets being transfered
   */
  let exerciseAssetAddress = claim.exerciseAsset!;
  let exercisePriceUSD = getTokenPriceUSD(exerciseAssetAddress);
  let exerciseAmount = event.params.exerciseAmountRedeemed
    .toBigDecimal()
    .div(
      exponentToBigDecimal(
        BigInt.fromI64(
          ERC20.bind(Address.fromString(exerciseAssetAddress)).decimals()
        )
      )
    );
  let exerciseValueUSD = exercisePriceUSD.times(exerciseAmount);

  let exerciseAsset = loadOrInitializeToken(
    Address.fromString(exerciseAssetAddress!)
  );
  exerciseAsset.totalValueLocked = exerciseAsset.totalValueLocked.minus(
    exerciseAmount
  );
  exerciseAsset.totalValueLockedUSD = exerciseAsset.totalValueLockedUSD.minus(
    exerciseValueUSD
  );
  exerciseAsset.save();

  /**
   * Handle Underlying Asset
   * retrieve value of underlying assets being transfered
   */
  let underlyingAssetAddress = claim.underlyingAsset as string;
  let underlyingPriceUSD = getTokenPriceUSD(underlyingAssetAddress);
  let underlyingAmount = event.params.underlyingAmountRedeemed
    .toBigDecimal()
    .div(
      exponentToBigDecimal(
        BigInt.fromI64(
          ERC20.bind(Address.fromString(underlyingAssetAddress)).decimals()
        )
      )
    );
  let underlyingValueUSD = underlyingPriceUSD.times(underlyingAmount);

  let underlyingAsset = loadOrInitializeToken(
    Address.fromString(underlyingAssetAddress as string)
  );
  underlyingAsset.totalValueLocked = underlyingAsset.totalValueLocked.minus(
    underlyingAmount
  );
  underlyingAsset.totalValueLockedUSD = underlyingAsset.totalValueLockedUSD.minus(
    underlyingValueUSD
  );
  underlyingAsset.save();

  /**
   * Handle Contract
   * Update TVL to reflect the value of the exercise and underlying tokens being transfered out.
   */
  let contract = fetchERC1155(event.address);
  contract.totalValueLockedUSD = contract.totalValueLockedUSD
    .minus(exerciseValueUSD)
    .minus(underlyingValueUSD);

  contract.save();

  /**
   * Handle Day Data
   */
  updateTokenDayData(exerciseAsset, event);
  let underlyingDayData = updateTokenDayData(underlyingAsset, event);
  underlyingDayData.volume = underlyingDayData.volume.plus(underlyingAmount);
  underlyingDayData.volumeUSD = underlyingDayData.volumeUSD.plus(
    underlyingValueUSD
  );
  underlyingDayData.save();

  let dayData = updateValoremDayData(event);
  dayData.volumeUSD = dayData.volumeUSD.plus(underlyingValueUSD);
  dayData.save();
}

export function handleFeeSwitchUpdated(event: FeeSwitchUpdated): void {
  let isEnabled = event.params.enabled;
  let feeTo = event.params.feeTo.toHexString();

  let feeSwitch = loadOrInitializeFeeSwitch(event.address.toHexString());
  feeSwitch.isEnabled = isEnabled;
  feeSwitch.feeToAddress = feeTo;
  feeSwitch.save();
}

export function handleFeeToUpdated(event: FeeToUpdated): void {
  let newFeeTo = event.params.newFeeTo.toHexString();

  let feeSwitch = loadOrInitializeFeeSwitch(event.address.toHexString());
  feeSwitch.feeToAddress = newFeeTo;
  feeSwitch.save();
}

export function handleFeeAccrued(event: FeeAccrued): void {
  let assetDecimals = BigInt.fromI64(ERC20.bind(event.params.asset).decimals());
  let formattedAmount = event.params.amount
    .toBigDecimal()
    .div(exponentToBigDecimal(assetDecimals));

  let assetPrice = getTokenPriceUSD(event.params.asset.toHexString());
  let feeValueUSD = assetPrice.times(formattedAmount);

  let dayData = updateValoremDayData(event);

  dayData.feesAccrued = dayData.feesAccrued.plus(feeValueUSD);

  dayData.save();
}

export function handleFeeSwept(event: FeeSwept): void {
  let assetDecimals = BigInt.fromI64(ERC20.bind(event.params.asset).decimals());
  let formattedAmount = event.params.amount
    .toBigDecimal()
    .div(exponentToBigDecimal(assetDecimals));

  let assetPrice = getTokenPriceUSD(event.params.asset.toHexString());
  let feeValueUSD = assetPrice.times(formattedAmount);

  let dayData = updateValoremDayData(event);

  dayData.feesSwept = dayData.feesSwept.plus(feeValueUSD);

  dayData.save();
}

export function handleNewOptionType(event: NewOptionType): void {
  let option = Option.load(event.params.optionId.toString());

  if (option == null) {
    option = new Option(event.params.optionId.toString());
    option.save();
  }

  option.creator = fetchAccount(event.transaction.from).id;
  option.underlyingAsset = fetchAccount(event.params.underlyingAsset).id;
  option.exerciseTimestamp = event.params.exerciseTimestamp;
  option.expiryTimestamp = event.params.expiryTimestamp;
  option.exerciseAsset = fetchAccount(event.params.exerciseAsset).id;
  option.underlyingAmount = event.params.underlyingAmount;
  option.exerciseAmount = event.params.exerciseAmount;

  option.save();

  let contract = fetchERC1155(event.address);
  let token = fetchERC1155Token(contract, event.params.optionId);
  token.option = event.params.optionId.toString();
  token.type = 1;
  token.save();

  let underlyingAsset = Token.load(event.params.underlyingAsset.toHexString());
  if (!underlyingAsset) {
    underlyingAsset = initializeToken(event.params.underlyingAsset);
  }

  let exerciseAsset = Token.load(event.params.exerciseAsset.toHexString());
  if (!exerciseAsset) {
    exerciseAsset = initializeToken(event.params.exerciseAsset);
  }
}

export function handleOptionsExercised(event: OptionsExercised): void {
  let option = Option.load(event.params.optionId.toString())!;

  /**
   * Handle Exercise Asset
   */
  let exerciseAssetAddress = option.exerciseAsset!;
  let exercisePriceUSD = getTokenPriceUSD(exerciseAssetAddress);
  let exerciseAmount = option
    .exerciseAmount!.toBigDecimal()
    .div(
      exponentToBigDecimal(
        BigInt.fromI64(
          ERC20.bind(Address.fromString(exerciseAssetAddress)).decimals()
        )
      )
    );
  let exerciseValueUSD = exercisePriceUSD
    .times(exerciseAmount)
    .times(event.params.amount.toBigDecimal());

  let exerciseAsset = loadOrInitializeToken(
    Address.fromString(exerciseAssetAddress)
  );
  exerciseAsset.totalValueLocked = exerciseAsset.totalValueLocked.plus(
    exerciseAmount
  );
  exerciseAsset.totalValueLockedUSD = exerciseAsset.totalValueLockedUSD.plus(
    exerciseValueUSD
  );
  exerciseAsset.save();

  /**
   * Handle Underlying Asset
   */
  let underlyingAssetAddress = option.underlyingAsset!;
  let underlyingPriceUSD = getTokenPriceUSD(underlyingAssetAddress);
  let underlyingAmount = option
    .underlyingAmount!.toBigDecimal()
    .div(
      exponentToBigDecimal(
        BigInt.fromI64(
          ERC20.bind(Address.fromString(underlyingAssetAddress)).decimals()
        )
      )
    );

  let underlyingValueUSD = underlyingPriceUSD
    .times(underlyingAmount)
    .times(event.params.amount.toBigDecimal());

  let underlyingAsset = loadOrInitializeToken(
    Address.fromString(underlyingAssetAddress)
  );
  underlyingAsset.totalValueLocked = underlyingAsset.totalValueLocked.minus(
    underlyingAmount
  );
  underlyingAsset.totalValueLockedUSD = underlyingAsset.totalValueLockedUSD.minus(
    underlyingValueUSD
  );
  underlyingAsset.save();

  /**
   * Handle Contract
   * Update TVL to reflect the value of the exercise tokens being transfered in
   * and underlying tokens being transfered out
   */
  let contract = fetchERC1155(event.address);
  contract.totalValueLockedUSD = contract.totalValueLockedUSD
    .plus(exerciseValueUSD)
    .minus(underlyingValueUSD);

  contract.save();

  /**
   * Handle Day Data
   */
  let dayData = updateValoremDayData(event);

  dayData.volumeUSD = dayData.volumeUSD.plus(underlyingValueUSD);

  dayData.save();

  let underlyingDayData = updateTokenDayData(underlyingAsset, event);
  underlyingDayData.volume = underlyingDayData.volume.plus(underlyingAmount);
  underlyingDayData.volumeUSD = underlyingDayData.volumeUSD.plus(
    underlyingValueUSD
  );
  underlyingDayData.save();

  updateTokenDayData(exerciseAsset, event);
}

export function handleOptionsWritten(event: OptionsWritten): void {
  let option = Option.load(event.params.optionId.toString())!;

  /**
   * Handle Underlying Asset
   */
  const underlyingAssetAddress = option.underlyingAsset!;

  const underlyingPriceUSD = getTokenPriceUSD(underlyingAssetAddress);

  const underlyingAmount = option
    .underlyingAmount!.toBigDecimal()
    .div(
      exponentToBigDecimal(
        BigInt.fromI64(
          ERC20.bind(Address.fromString(underlyingAssetAddress)).decimals()
        )
      )
    );

  const underlyingValueUSD = underlyingPriceUSD
    .times(underlyingAmount)
    .times(event.params.amount.toBigDecimal());

  let underlyingAsset = loadOrInitializeToken(
    Address.fromString(underlyingAssetAddress)
  );

  underlyingAsset.totalValueLocked = underlyingAsset.totalValueLocked.plus(
    underlyingAmount
  );
  underlyingAsset.totalValueLockedUSD = underlyingAsset.totalValueLockedUSD.plus(
    underlyingValueUSD
  );

  underlyingAsset.save();

  /**
   * Handle Contract
   * Update TVL to reflect the value of underlying tokens being transfered in.
   */
  let contract = fetchERC1155(event.address);
  contract.totalValueLockedUSD = contract.totalValueLockedUSD.plus(
    underlyingValueUSD
  );
  contract.save();

  /**
   * Handle Token
   */
  let token = fetchERC1155Token(contract, event.params.claimId);
  token.claim = event.params.claimId.toString();
  token.type = 2;
  token.save();

  /**
   * Handle Day Data
   */
  let dayData = updateValoremDayData(event);
  dayData.volumeUSD = dayData.volumeUSD.plus(underlyingValueUSD);
  dayData.save();

  let underlyingDayData = updateTokenDayData(underlyingAsset, event);
  underlyingDayData.volume = underlyingDayData.volume.plus(underlyingAmount);
  underlyingDayData.volumeUSD = underlyingDayData.volumeUSD.plus(
    underlyingValueUSD
  );
  underlyingDayData.save();

  /**
   * Handle Claim
   */
  let claim = Claim.load(event.params.claimId.toString());

  if (claim == null) {
    claim = new Claim(event.params.claimId.toString());
    claim.save();
  }

  claim.option = event.params.optionId.toString();
  claim.writer = fetchAccount(event.transaction.from).id;
  claim.amountWritten = event.params.amount;
  claim.amountExercised = BigInt.fromI32(0);
  claim.claimed = false;
  claim.exerciseAsset = option.exerciseAsset;
  claim.exerciseAmount = option.exerciseAmount;
  claim.underlyingAsset = option.underlyingAsset;
  claim.underlyingAmount = option.underlyingAmount;
  claim.save();
}

// Credit to https://github.com/OpenZeppelin/openzeppelin-subgraphs

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
  // TODO(Should these really be ignored?)
  // @ts-ignore
  let ev = new ERC1155Transfer(events.id(event).concat(suffix));
  ev.emitter = token.id;
  // @ts-ignore
  ev.transaction = transactions.log(event).id;
  ev.timestamp = event.block.timestamp;
  ev.contract = contract.id;
  ev.token = token.id;
  ev.operator = operator.id;
  ev.value = decimals.toDecimals(value);
  ev.valueExact = value;

  if (Address.fromString(from.id) == constants.ADDRESS_ZERO) {
    let totalSupply = fetchERC1155Balance(token, null);
    totalSupply.valueExact = totalSupply.valueExact.plus(value);
    totalSupply.value = decimals.toDecimals(totalSupply.valueExact);
    totalSupply.save();
  } else {
    let balance = fetchERC1155Balance(token, from);
    balance.valueExact = balance.valueExact.minus(value);
    balance.value = decimals.toDecimals(balance.valueExact);
    balance.save();

    ev.from = from.id;
    ev.fromBalance = balance.id;
  }

  if (Address.fromString(to.id) == constants.ADDRESS_ZERO) {
    let totalSupply = fetchERC1155Balance(token, null);
    totalSupply.valueExact = totalSupply.valueExact.minus(value);
    totalSupply.value = decimals.toDecimals(totalSupply.valueExact);
    totalSupply.save();
  } else {
    let balance = fetchERC1155Balance(token, to);
    balance.valueExact = balance.valueExact.plus(value);
    balance.value = decimals.toDecimals(balance.valueExact);
    balance.save();

    ev.to = to.id;
    ev.toBalance = balance.id;
  }

  token.save();
  ev.save();
}

export function handleTransferSingle(event: TransferSingleEvent): void {
  let contract = fetchERC1155(event.address);
  let operator = fetchAccount(event.params.operator);
  let from = fetchAccount(event.params.from);
  let to = fetchAccount(event.params.to);

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
}

export function handleTransferBatch(event: TransferBatchEvent): void {
  let contract = fetchERC1155(event.address);
  let operator = fetchAccount(event.params.operator);
  let from = fetchAccount(event.params.from);
  let to = fetchAccount(event.params.to);

  let ids = event.params.ids;
  let values = event.params.amounts;

  // If this equality doesn't hold (some devs actually don't follox the ERC specifications) then we just can't make
  // sens of what is happening. Don't try to make something out of stupid code, and just throw the event. This
  // contract doesn't follow the standard anyway.
  if (ids.length == values.length) {
    for (let i = 0; i < ids.length; ++i) {
      registerTransfer(
        event,
        "/".concat(i.toString()),
        contract,
        operator,
        from,
        to,
        ids[i],
        values[i]
      );
    }
  }
}

export function handleApprovalForAll(event: ApprovalForAllEvent): void {
  let contract = fetchERC1155(event.address);
  let owner = fetchAccount(event.params.owner);
  let operator = fetchAccount(event.params.operator);
  let delegation = fetchERC721Operator(contract, owner, operator);
  delegation.approved = event.params.approved;
  delegation.save();
}

export function handleURI(event: URIEvent): void {
  let contract = fetchERC1155(event.address);
  let token = fetchERC1155Token(contract, event.params.id);
  token.uri = replaceURI(event.params.value, event.params.id);
  token.save();
}
