// Credit to https://github.com/OpenZeppelin/openzeppelin-subgraphs
import { Account } from "../../generated/schema";

export function fetchAccount(address: string): Account {
  let account = Account.load(address);
  if (account) return account;

  // init
  account = new Account(address);
  account.save();
  return account;
}
