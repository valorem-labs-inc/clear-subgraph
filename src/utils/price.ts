/**
 * The following code is credited to https://github.com/Uniswap/v3-subgraph,
 * Included under GNU GPL v3 License
 * Extended to support Valorem
 */

import { Address, BigDecimal, BigInt } from "@graphprotocol/graph-ts";
import { UniswapV3Factory } from "../../generated/ValoremOptionsClearinghouse/UniswapV3Factory";
import { UniswapV3Pool } from "../../generated/ValoremOptionsClearinghouse/UniswapV3Pool";
import { ERC20 } from "../../generated/ValoremOptionsClearinghouse/ERC20";
import { ZERO_ADDRESS } from "./constants";

const WETH_ADDRESS = "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6";

const UNISWAP_V3_FACTORY_ADDRESS = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

let MINIMUM_ETH_LOCKED = BigDecimal.fromString("60");

const TOKEN_WHITELIST = [
  WETH_ADDRESS,
  "0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60", // DAI
  "0xD87Ba7A50B2E7E660f678A895E4B72E7CB4CCd9C", // USDC
  "0x822397d9a55d0fefd20F5c4bCaB33C5F65bd28Eb", // cDAI
  "0xD87Ba7A50B2E7E660f678A895E4B72E7CB4CCd9C", // cUSDC
  "0xe16C7165C8FeA64069802aE4c4c9C320783f2b6e", // COMP
  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", // UNI
  "0xC04B0d3107736C32e19F1c62b2aF67BE61d63a05", // WBTC
];

// Gets ETHs price in USD using the DAI / WETH Uniswap V3 pool.
export function getEthPriceInUSD(): BigDecimal {
  // TODO: REVERT FOR MAINNET. GOERLI POOLS ARE INACCURATE
  // ! hardcode ETH price 1550 USD
  return BigDecimal.fromString("1550");
  let factory = UniswapV3Factory.bind(
    Address.fromString(UNISWAP_V3_FACTORY_ADDRESS)
  );

  let daiPoolAddress = factory.getPool(
    Address.fromString(WETH_ADDRESS),
    Address.fromString("0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60"),
    3000
  );

  let daiPool = UniswapV3Pool.bind(daiPoolAddress);

  const tokenPrices = sqrtPriceX96ToTokenPrices(
    daiPool.slot0().value0,
    ERC20.bind(daiPool.token0()),
    ERC20.bind(daiPool.token1())
  );

  if (
    daiPool
      .token0()
      .toHexString()
      .toLowerCase() == WETH_ADDRESS.toLowerCase()
  ) {
    return tokenPrices[1];
  }

  return tokenPrices[0];
}

export function getTokenPriceUSD(tokenAddress: string): BigDecimal {
  const ethPriceUSD = getEthPriceInUSD(); // ! Hardcoded

  const derivedEth = findEthPerToken(tokenAddress); // ! Hardcoded

  if (
    tokenAddress.toLowerCase() == WETH_ADDRESS.toLowerCase() ||
    tokenAddress.toLowerCase() == ZERO_ADDRESS.toLowerCase()
  ) {
    return ethPriceUSD;
  }

  return derivedEth.times(ethPriceUSD);
}

// Derives token price in ETH terms by using either the token / WETH pool,
// or a whitelisted tokens WETH pool.
export function findEthPerToken(tokenAddress: string): BigDecimal {
  // TODO REVERT FOR MAINNET. GOERLI POOLS ARE INACCURATE
  // ! hardcode ERC20 price 1/1550 USD (stablecoins)
  return BigDecimal.fromString("0.00064");

  const uniswapFactory = UniswapV3Factory.bind(
    Address.fromString(UNISWAP_V3_FACTORY_ADDRESS)
  );

  if (tokenAddress.toLowerCase() == WETH_ADDRESS.toLowerCase()) {
    return BigDecimal.fromString("1");
  }

  for (let i = 0; i < TOKEN_WHITELIST.length; i++) {
    const poolAddress = uniswapFactory.getPool(
      Address.fromString(tokenAddress),
      Address.fromString(TOKEN_WHITELIST[i]),
      3000
    );

    if (poolAddress.toHexString() != ZERO_ADDRESS) {
      let pool = UniswapV3Pool.bind(poolAddress);
      let token0Address = pool.token0();
      let token1Address = pool.token1();

      if (pool.liquidity().gt(BigInt.fromString("0"))) {
        if (
          token0Address.toHexString().toLowerCase() ==
          tokenAddress.toLowerCase()
        ) {
          // whitelist token is token1
          let token1 = ERC20.bind(pool.token1());

          // get the derived ETH in pool
          let token1DerivedEth = findEthPerToken(pool.token1().toHexString());

          let ethLocked = token1
            .balanceOf(poolAddress)
            .toBigDecimal()
            .times(token1DerivedEth);

          if (ethLocked.gt(MINIMUM_ETH_LOCKED)) {
            const tokenPrices = sqrtPriceX96ToTokenPrices(
              pool.slot0().value0,
              ERC20.bind(pool.token0()),
              token1
            );
            const token1Price = tokenPrices[1];
            return token1Price.times(token1DerivedEth);
          }
        }

        if (
          token1Address.toHexString().toLowerCase() ==
          tokenAddress.toLowerCase()
        ) {
          let token0 = ERC20.bind(pool.token0());

          // get the derived ETH in pool
          let token0DerivedEth = findEthPerToken(pool.token0().toHexString());

          let ethLocked = token0
            .balanceOf(poolAddress)
            .toBigDecimal()
            .times(token0DerivedEth);

          if (ethLocked.gt(MINIMUM_ETH_LOCKED)) {
            const tokenPrices = sqrtPriceX96ToTokenPrices(
              pool.slot0().value0,
              token0,
              ERC20.bind(pool.token1())
            );
            const token0Price = tokenPrices[0];
            return token0Price.times(token0DerivedEth);
          }
        }
      }
    }
  }

  return BigDecimal.zero();
}

// return 0 if denominator is 0 in division
export function safeDiv(amount0: BigDecimal, amount1: BigDecimal): BigDecimal {
  if (amount1.equals(BigDecimal.zero())) {
    return BigDecimal.zero();
  } else {
    return amount0.div(amount1);
  }
}

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString("1");
  for (
    let i = BigInt.fromString("0");
    i.lt(decimals as BigInt);
    i = i.plus(BigInt.fromString("1"))
  ) {
    bd = bd.times(BigDecimal.fromString("10"));
  }
  return bd;
}

export function sqrtPriceX96ToTokenPrices(
  sqrtPriceX96: BigInt,
  token0: ERC20,
  token1: ERC20
): BigDecimal[] {
  const Q192 = BigInt.fromI32(2).pow(192);

  let num = sqrtPriceX96.times(sqrtPriceX96).toBigDecimal();
  let denom = BigDecimal.fromString(Q192.toString());

  let price1 = num
    .div(denom)
    .times(exponentToBigDecimal(BigInt.fromI64(token0.decimals())))
    .div(exponentToBigDecimal(BigInt.fromI64(token1.decimals())));

  let price0 = safeDiv(BigDecimal.fromString("1"), price1);

  return [price0, price1];
}
