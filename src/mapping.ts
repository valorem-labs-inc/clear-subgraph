import { BigInt, ethereum } from "@graphprotocol/graph-ts"
import {
  OptionsSettlementEngine,
  ClaimRedeemed,
  ExerciseAssigned,
  FeeAccrued,
  FeeSwept,
  NewChain,
  OptionsExercised,
  OptionsWritten,
  URI
} from "../generated/OptionsSettlementEngine/OptionsSettlementEngine"

import { Account, Balance, Claim, Option, Token, TokenRegistry, Transaction, Transfer } from "../generated/schema"

import {
  TransferBatch as TransferBatchEvent,
  TransferSingle as TransferSingleEvent,
} from '../generated/OptionsSettlementEngine/IERC1155';

import { IERC1155MetadataURI } from '../generated/OptionsSettlementEngine/IERC1155MetadataURI';

function fetchToken(registry: TokenRegistry, id: BigInt): Token {
  let tokenid = registry.id.concat('-').concat(id.toHex());
  let token = Token.load(tokenid);
  if (token == null) {
    token = new Token(tokenid);
    token.registry = registry.id;
    token.identifier = id;
    token.totalSupply = new BigInt(0);
  }
  return token as Token;
}

function fetchBalance(token: Token, account: Account): Balance {
  let balanceid = token.id.concat('-').concat(account.id);
  let balance = Balance.load(balanceid);
  if (balance == null) {
    balance = new Balance(balanceid);
    balance.token = token.id;
    balance.account = account.id;
    balance.value = new BigInt(0);
  }
  return balance as Balance;
}

function registerTransfer(
  event: ethereum.Event,
  suffix: string,
  registry: TokenRegistry,
  operator: Account,
  from: Account,
  to: Account,
  id: BigInt,
  value: BigInt
): void {
  let token = fetchToken(registry, id);
  let contract = IERC1155MetadataURI.bind(event.address);
  let ev = new Transfer(event.block.number.toString().concat('-').concat(event.logIndex.toString()).concat(suffix));

  let tx = new Transaction(event.transaction.hash.toHex())
		tx.timestamp   = event.block.timestamp
		tx.blockNumber = event.block.number
    tx.save();
  ev.transaction = tx.id;
  ev.timestamp = event.block.timestamp;
  ev.token = token.id;
  ev.operator = operator.id;
  ev.from = from.id;
  ev.to = to.id;
  ev.value = value;

  if (from.id == '0x0000000000000000000000000000000000000000') {
    token.totalSupply = token.totalSupply.plus(value)
  } else {
    let balance = fetchBalance(token, from);
    balance.value = balance.value.minus(value);
    balance.save();
    ev.fromBalance = balance.id;
  }

  if (to.id == '0x0000000000000000000000000000000000000000') {
    token.totalSupply = token.totalSupply.minus(value);
  } else {
    let balance = fetchBalance(token, to);
    balance.value = balance.value.plus(value);
    balance.save();
    ev.toBalance = balance.id;
  }

  let callResult = contract.try_uri(id);
  if (!callResult.reverted) {
    token.URI = callResult.value;
  }

  // let nameResult = contract.try_name();
  // let symbolResult = contract.try_symbol();

  token.save();
  ev.save();
}


export function handleClaimRedeemed(event: ClaimRedeemed): void {
  let claim = Claim.load(event.params.claimId.toString());

  if (claim == null) {
    claim = new Claim(event.params.claimId.toString());
  }

  // add data to claim
  claim.option = event.params.optionId;
  claim.redeemer = event.params.redeemer;
  claim.exerciseAsset = event.params.exerciseAsset;
  claim.underlyingAsset = event.params.underlyingAsset;
  claim.exerciseAmount = event.params.exerciseAmount;
  claim.underlyingAmount = event.params.underlyingAmount;

  claim.save();
}

export function handleExerciseAssigned(event: ExerciseAssigned): void {
  let claim = Claim.load(event.params.claimId.toString());

  if (claim == null) {
    claim = new Claim(event.params.claimId.toString());
  }

  claim.option = event.params.optionId;
  claim.amountExercised = event.params.amountAssigned;
  claim.claimed = true;

  claim.save();
}

export function handleFeeAccrued(event: FeeAccrued): void {
  
}

export function handleFeeSwept(event: FeeSwept): void {

}

export function handleNewChain(event: NewChain): void {
  let option = Option.load(event.params.optionId.toString());
  let registry = new TokenRegistry(event.address.toHex());

    if (option == null) {
        option = new Option(event.params.optionId.toString());
    }

  let token = fetchToken(registry, event.params.optionId);
  let engine = OptionsSettlementEngine.bind(event.address);
    // How to make a call here?
  let callResult = engine.try_tokenType(event.params.optionId);
  if (!callResult.reverted) {
    token.type = callResult.value;
    token.save();
  }

  option.underlyingAsset = event.params.underlyingAsset;
  option.exerciseTimestamp = event.params.exerciseTimestamp;
  option.expiryTimestamp = event.params.expiryTimestamp;
  option.exerciseAsset = event.params.exerciseAsset;
  option.underlyingAmount = event.params.underlyingAmount;
  option.exerciseAmount = event.params.exerciseAmount;

  option.save();
}

export function handleOptionsExercised(event: OptionsExercised): void {
  let option = Option.load(event.params.optionId.toString());

  if (option == null) {
    option = new Option(event.params.optionId.toString());
  }

  option.exercisee = event.params.exercisee;
  option.amount = event.params.amount;

  option.save();
}

export function handleOptionsWritten(event: OptionsWritten): void {
  let option = Option.load(event.params.optionId.toString());

      if (option == null) {
          option = new Option(event.params.optionId.toString());
          option.save();
      }

      // option written and now is able to have anyone use it
      option.claimId = event.params.claimId
      option.amount = event.params.amount

      option.save();
}


export function handleTransferBatch(event: TransferBatchEvent): void {
  let registry = new TokenRegistry(event.address.toHex());
  let operator = new Account(event.params.operator.toHex());
  let from = new Account(event.params.from.toHex());
  let to = new Account(event.params.to.toHex());
  registry.save();
  operator.save();
  from.save();
  to.save();

  let ids = event.params.ids;
  let values = event.params.values;
  for (let i = 0; i < ids.length; ++i) {
    registerTransfer(
      event,
      '-'.concat(i.toString()),
      registry,
      operator,
      from,
      to,
      ids[i],
      values[i]
    );
  }
}

export function handleTransferSingle(event: TransferSingleEvent): void {
  let registry = new TokenRegistry(event.address.toHex());
  let operator = new Account(event.params.operator.toHex());
  let from = new Account(event.params.from.toHex());
  let to = new Account(event.params.to.toHex());
  registry.save();
  operator.save();
  from.save();
  to.save();

  registerTransfer(
    event,
    '',
    registry,
    operator,
    from,
    to,
    event.params.id,
    event.params.value
  );
}

export function handleURI(event: URI): void {
  let registry = new TokenRegistry(event.address.toHex());
  registry.save();

  let token = fetchToken(registry, event.params.id);
  token.URI = event.params.value;
  token.save();
}
