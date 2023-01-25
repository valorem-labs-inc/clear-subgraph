// Credit to https://github.com/OpenZeppelin/openzeppelin-subgraphs, included under MIT License

import { Address, BigInt } from "@graphprotocol/graph-ts";

import {
  Account,
  ERC1155Contract,
  ERC1155Token,
  ERC1155Balance,
  ERC1155Operator,
} from "../../generated/schema";

import { IERC1155MetadataURI } from "../../generated/OptionSettlementEngine/IERC1155MetadataURI";

import { constants } from "../constants";

import { fetchAccount } from "../fetch/account";

export function replaceURI(uri: string, identifier: BigInt): string {
  return uri.replaceAll(
    "{id}",
    identifier
      .toHex()
      .slice(2)
      .padStart(64, "0")
  );
}

/**
 * Searches for and returns an ERC-1155 Contract, initializing a new one if not found
 * Note: Only the OptionSettlementEngine at this time
 * @param {string} contractAddress.toHexString()
 * @return {ERC1155Contract}
 */
export function fetchERC1155(address: string): ERC1155Contract {
  let account = fetchAccount(address);
  let contract = ERC1155Contract.load(account.id);

  if (contract == null) {
    contract = new ERC1155Contract(account.id);
    contract.save();
  }
  contract.asAccount = account.id;
  account.asERC1155 = contract.id;
  contract.save();
  account.save();

  return contract;
}

/**
 * Searches for and returns an ERC-1155 Token, initializing a new one if not found
 * @param {ERC1155Contract} contract
 * @param {BigInt} identifier
 * @return {ERC1155Token}
 */
export function fetchERC1155Token(
  contract: ERC1155Contract,
  identifier: BigInt
): ERC1155Token {
  let id = contract.id.concat("/").concat(identifier.toHex());
  let token = ERC1155Token.load(id);

  if (token == null) {
    let erc1155 = IERC1155MetadataURI.bind(Address.fromString(contract.id));
    let try_uri = erc1155.try_uri(identifier);
    token = new ERC1155Token(id);
    token.contract = contract.id;
    token.identifier = identifier;
    token.totalSupply = fetchERC1155Balance(token as ERC1155Token, null).id;
    token.uri = try_uri.reverted ? null : replaceURI(try_uri.value, identifier);
    token.save();
  }

  return token as ERC1155Token;
}

/**
 * Searches for and returns the balance of a specific ERC-1155 for a given Account, initializing a new one if not found
 * @param {ERC1155Token} token: optionId or claimId
 * @param {(Account | null)} account
 * @return {ERC1155Balance}
 */
export function fetchERC1155Balance(
  token: ERC1155Token,
  account: Account | null
): ERC1155Balance {
  let id = token.id.concat("/").concat(account ? account.id : "totalSupply");
  let balance = ERC1155Balance.load(id);

  if (balance == null) {
    balance = new ERC1155Balance(id);
    balance.contract = token.contract;
    balance.token = token.id;
    balance.account = account ? account.id : null;
    balance.value = constants.BIGDECIMAL_ZERO;
    balance.valueExact = constants.BIGINT_ZERO;
    balance.save();
  }

  return balance as ERC1155Balance;
}

/**
 * Searches for and returns an ERC-1155 Operator for a given Contract & Account, initializing a new one if not found
 * @param {ERC1155Contract} contract: OSE Address
 * @param {Account} owner
 * @param {Account} operator
 * @return {ERC1155Operator}
 */
export function fetchERC1155Operator(
  contract: ERC1155Contract,
  owner: Account,
  operator: Account
): ERC1155Operator {
  let id = contract.id
    .concat("/")
    .concat(owner.id)
    .concat("/")
    .concat(operator.id);
  let op = ERC1155Operator.load(id);

  if (op == null) {
    op = new ERC1155Operator(id);
    op.contract = contract.id;
    op.owner = owner.id;
    op.operator = operator.id;
  }

  return op as ERC1155Operator;
}
