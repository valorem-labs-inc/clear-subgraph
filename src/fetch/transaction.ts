import { ethereum } from "@graphprotocol/graph-ts";
import { Transaction } from "../../generated/schema";

/**
 * Searches for and return an Transaction, initializing a new one if not found
 * @param {string} address.toHexString()
 * @return {Transaction}
 */
export function fetchTransaction(event: ethereum.Event): Transaction {
  let tx = new Transaction(event.transaction.hash.toHex());
  tx.timestamp = event.block.timestamp;
  tx.blockNumber = event.block.number;
  tx.save();
  return tx as Transaction;
}
