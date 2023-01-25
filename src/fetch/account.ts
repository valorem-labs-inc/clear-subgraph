// Credit to https://github.com/OpenZeppelin/openzeppelin-subgraphs, included under MIT License

import { Account } from "../../generated/schema";

/**
 * Searches for and returns an Account, initializing a new one if not found
 * @param {string} address.toHexString()
 * @return {*}  {Account}
 */
export function fetchAccount(address: string): Account {
  let account = Account.load(address);
  if (account) return account;

  account = new Account(address);
  account.save();
  return account;
}
