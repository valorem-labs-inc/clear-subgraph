import {
  ethereum,
  BigInt, Address, log,
} from '@graphprotocol/graph-ts'

import {
  Account,
  ERC1155Contract,
  ERC1155Transfer,
} from '../generated/schema'

import {
  OptionSettlementEngine,
  ApprovalForAll as ApprovalForAllEvent,
  ClaimRedeemed,
  ExerciseAssigned,
  FeeAccrued,
  FeeSwept,
  NewChain,
  OptionsExercised,
  OptionsWritten,
  TransferBatch as TransferBatchEvent,
  TransferSingle as TransferSingleEvent,
  URI as URIEvent
} from "../generated/OptionSettlementEngine/OptionSettlementEngine"
import { Option, Claim } from "../generated/schema"
import { UniswapV3Factory } from "../generated/OptionSettlementEngine/UniswapV3Factory";

import {
  constants
} from './constants'

import {
  decimals
} from './decimals'

import {
  events
} from './events'

import {
  transactions
} from './transactions'

import {
  fetchAccount,
} from './fetch/account'

import {
  fetchERC1155,
  fetchERC1155Token,
  fetchERC1155Balance,
  fetchERC721Operator,
  replaceURI,
} from './fetch/erc1155'
import { exponentToBigDecimal, getTokenPriceUSD } from './utils/price';
import { ZERO_ADDRESS } from './utils/constants';
import { ERC20 } from '../generated/OptionSettlementEngine/ERC20';
import { updateValoremDayData } from './utils';

// TODO(Implement these)

export function handleClaimRedeemed(event: ClaimRedeemed): void {
  let claim = Claim.load(event.params.claimId.toString());

  if (claim == null) {
    claim = new Claim(event.params.claimId.toString());
    claim.save()
  }

  // add data to claim
  claim.option = event.params.optionId.toString();
  claim.claimed = true;
  claim.claimant = fetchAccount(event.params.redeemer).id;
  claim.exerciseAsset = fetchAccount(event.params.exerciseAsset).id;
  claim.underlyingAsset = fetchAccount(event.params.underlyingAsset).id;
  claim.exerciseAmount = event.params.exerciseAmount;
  claim.underlyingAmount = event.params.underlyingAmount;

  claim.save();

  let exerciseAsset = claim.exerciseAsset as string;
  let exercisePriceUSD = getTokenPriceUSD(exerciseAsset);
  let exerciseAmount = event.params.exerciseAmount
    .toBigDecimal()
    .div(
      exponentToBigDecimal(
        BigInt.fromI64(ERC20.bind(Address.fromString(exerciseAsset)).decimals())
      )
    );
  let exerciseValueUSD = exercisePriceUSD.times(exerciseAmount);

  let underlyingAsset = claim.underlyingAsset as string;
  let underlyingPriceUSD = getTokenPriceUSD(underlyingAsset);
  let underlyingAmount = event.params.underlyingAmount
    .toBigDecimal()
    .div(
      exponentToBigDecimal(
        BigInt.fromI64(
          ERC20.bind(Address.fromString(underlyingAsset)).decimals()
        )
      )
    );

  let underlyingValueUSD = underlyingPriceUSD.times(underlyingAmount);

  let contract = fetchERC1155(event.address);

  contract.totalValueLockedUSD = contract.totalValueLockedUSD.minus(exerciseValueUSD).minus(underlyingValueUSD);

  contract.save();

  updateValoremDayData(event);
}

export function handleExerciseAssigned(event: ExerciseAssigned): void {

}

export function handleFeeAccrued(event: FeeAccrued): void {

}

export function handleFeeSwept(event: FeeSwept): void {

}

export function handleNewChain(event: NewChain): void {
  let option = Option.load(event.params.optionId.toString());


  if (option == null) {
    option = new Option(event.params.optionId.toString());
    option.save()
  }

  option.creator = fetchAccount(event.transaction.from).id;
  option.underlyingAsset = fetchAccount(event.params.underlyingAsset).id;
  option.exerciseTimestamp = event.params.exerciseTimestamp;
  option.expiryTimestamp = event.params.expiryTimestamp;
  option.exerciseAsset = fetchAccount(event.params.exerciseAsset).id;
  option.underlyingAmount = event.params.underlyingAmount;
  option.exerciseAmount = event.params.exerciseAmount;

  option.save();

  let contract = fetchERC1155(event.address)
  let token = fetchERC1155Token(contract, event.params.optionId);
  token.option = event.params.optionId.toString();
  token.type = 1;
  token.save()
}

export function handleOptionsExercised(event: OptionsExercised): void {
  let option = Option.load(event.params.optionId.toString());

  if (option === null) {
    option = new Option(event.params.optionId.toString());
  }

  let exerciseAsset = option.exerciseAsset as string;
  let exercisePriceUSD = getTokenPriceUSD(exerciseAsset);
  let exerciseAmount = (option.exerciseAmount as BigInt)
    .toBigDecimal()
    .div(
      exponentToBigDecimal(
        BigInt.fromI64(ERC20.bind(Address.fromString(exerciseAsset)).decimals())
      )
    );
  let exerciseValueUSD = exercisePriceUSD.times(exerciseAmount).times(event.params.amount.toBigDecimal());

  let underlyingAsset = option.underlyingAsset as string;
  let underlyingPriceUSD = getTokenPriceUSD(underlyingAsset);
  let underlyingAmount = (option.underlyingAmount as BigInt)
    .toBigDecimal()
    .div(
      exponentToBigDecimal(
        BigInt.fromI64(
          ERC20.bind(Address.fromString(underlyingAsset)).decimals()
        )
      )
    );

  let underlyingValueUSD = underlyingPriceUSD.times(underlyingAmount).times(event.params.amount.toBigDecimal());

  let contract = fetchERC1155(event.address);

  contract.totalValueLockedUSD = contract.totalValueLockedUSD.plus(exerciseValueUSD).minus(underlyingValueUSD);

  contract.save();

  updateValoremDayData(event);
}

export function handleOptionsWritten(event: OptionsWritten): void {
  let claim = Claim.load(event.params.claimId.toString());

  if (claim == null) {
    claim = new Claim(event.params.claimId.toString());
    claim.save()
  }

  // TODO(There should be a claim created event or something containing the required metadata)
  claim.option = event.params.optionId.toString();
  claim.claimed = false;
  claim.writer = fetchAccount(event.transaction.from).id;
  claim.amountWritten = event.params.amount;
  claim.save();

  let contract = fetchERC1155(event.address)
  let token = fetchERC1155Token(contract, event.params.claimId);
  token.claim = event.params.claimId.toString();
  token.type = 2;
  token.save();

  let option = Option.load(event.params.optionId.toString())
  if (option == null) {
    option = new Option(event.params.optionId.toString());
    option.save()
  }

  const underlyingAsset = option.underlyingAsset ? option.underlyingAsset : ZERO_ADDRESS;

  const underlyingPriceUSD = getTokenPriceUSD(underlyingAsset as string);

  const underlyingAmount = (option.underlyingAmount as BigInt).toBigDecimal().div(exponentToBigDecimal(BigInt.fromI64(ERC20.bind(Address.fromString(underlyingAsset as string)).decimals())))

  const underlyingValueUSD = underlyingPriceUSD.times(underlyingAmount).times(event.params.amount.toBigDecimal());
  
  contract.totalValueLockedUSD = contract.totalValueLockedUSD.plus(underlyingValueUSD);
  contract.save();

  updateValoremDayData(event);
}

// Credit to https://github.com/OpenZeppelin/openzeppelin-subgraphs

function registerTransfer(
    event:    ethereum.Event,
    suffix:   string,
    contract: ERC1155Contract,
    operator: Account,
    from:     Account,
    to:       Account,
    id:       BigInt,
    value:    BigInt)
    : void
{
  let token      = fetchERC1155Token(contract, id)
  // TODO(Should these really be ignored?)
  // @ts-ignore
  let ev         = new ERC1155Transfer(events.id(event).concat(suffix))
  ev.emitter     = token.id
  // @ts-ignore
  ev.transaction = transactions.log(event).id
  ev.timestamp   = event.block.timestamp
  ev.contract    = contract.id
  ev.token       = token.id
  ev.operator    = operator.id
  ev.value       = decimals.toDecimals(value)
  ev.valueExact  = value

  if (Address.fromString(from.id) == constants.ADDRESS_ZERO) {
    let totalSupply        = fetchERC1155Balance(token, null)
    totalSupply.valueExact = totalSupply.valueExact.plus(value)
    totalSupply.value      = decimals.toDecimals(totalSupply.valueExact)
    totalSupply.save()
  } else {
    let balance            = fetchERC1155Balance(token, from)
    balance.valueExact     = balance.valueExact.minus(value)
    balance.value          = decimals.toDecimals(balance.valueExact)
    balance.save()

    ev.from                = from.id
    ev.fromBalance         = balance.id
  }

  if (Address.fromString(to.id) == constants.ADDRESS_ZERO) {
    let totalSupply        = fetchERC1155Balance(token, null)
    totalSupply.valueExact = totalSupply.valueExact.minus(value)
    totalSupply.value      = decimals.toDecimals(totalSupply.valueExact)
    totalSupply.save()
  } else {
    let balance            = fetchERC1155Balance(token, to)
    balance.valueExact     = balance.valueExact.plus(value)
    balance.value          = decimals.toDecimals(balance.valueExact)
    balance.save()

    ev.to                  = to.id
    ev.toBalance           = balance.id
  }

  token.save()
  ev.save()
}

export function handleTransferSingle(event: TransferSingleEvent): void
{
  let contract = fetchERC1155(event.address)
  let operator = fetchAccount(event.params.operator)
  let from     = fetchAccount(event.params.from)
  let to       = fetchAccount(event.params.to)

  registerTransfer(
      event,
      "",
      contract,
      operator,
      from,
      to,
      event.params.id,
      event.params.amount
  )
}

export function handleTransferBatch(event: TransferBatchEvent): void
{
  let contract = fetchERC1155(event.address)
  let operator = fetchAccount(event.params.operator)
  let from     = fetchAccount(event.params.from)
  let to       = fetchAccount(event.params.to)

  let ids    = event.params.ids
  let values = event.params.amounts

  // If this equality doesn't hold (some devs actually don't follox the ERC specifications) then we just can't make
  // sens of what is happening. Don't try to make something out of stupid code, and just throw the event. This
  // contract doesn't follow the standard anyway.
  if(ids.length == values.length)
  {
    for (let i = 0;  i < ids.length; ++i)
    {
      registerTransfer(
          event,
          "/".concat(i.toString()),
          contract,
          operator,
          from,
          to,
          ids[i],
          values[i]
      )
    }
  }
}

export function handleApprovalForAll(event: ApprovalForAllEvent): void {
  let contract         = fetchERC1155(event.address)
  let owner            = fetchAccount(event.params.owner)
  let operator         = fetchAccount(event.params.operator)
  let delegation       = fetchERC721Operator(contract, owner, operator)
  delegation.approved  = event.params.approved
  delegation.save()
}

export function handleURI(event: URIEvent): void
{
  let contract = fetchERC1155(event.address)
  let token    = fetchERC1155Token(contract, event.params.id)
  token.uri    = replaceURI(event.params.value, event.params.id)
  token.save()
}
