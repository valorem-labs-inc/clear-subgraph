/**
 * The following code is credited to https://github.com/Uniswap/v3-subgraph,
 * Included under GNU GPL v3 License
 * Extended to support Valorem
 */

import { Address, BigDecimal, BigInt } from "@graphprotocol/graph-ts";
import { UniswapV3Factory } from "../../generated/ValoremOptionsClearinghouse/UniswapV3Factory";
import { UniswapV3Pool } from "../../generated/ValoremOptionsClearinghouse/UniswapV3Pool";
import { ERC20 } from "../../generated/ValoremOptionsClearinghouse/ERC20";
import { constants } from "../constants";

// @ts-expect-error template
const isTestnet = "{{network}}" === "arbitrum-sepolia";

const UNISWAP_V3_FACTORY_ADDRESS = "{{UNISWAP_V3_FACTORY_ADDRESS}}";

const WETH_ADDRESS = "{{WETH_ADDRESS}}";
const USDC_ADDRESS = "{{USDC_ADDRESS}}";
const WBTC_ADDRESS = "{{WBTC_ADDRESS}}";
const ARB_ADDRESS = "{{ARB_ADDRESS}}";

const TOKEN_WHITELIST = [WETH_ADDRESS, USDC_ADDRESS, WBTC_ADDRESS, ARB_ADDRESS];

let MINIMUM_ETH_LOCKED = BigDecimal.fromString("60");

// Gets ETHs price in USD using the DAI / WETH Uniswap V3 pool.
function getEthPriceInUSD(): BigDecimal {
  // hardcode sepolia price
  if (isTestnet) return BigDecimal.fromString("1550");

  let factory = UniswapV3Factory.bind(
    Address.fromString(UNISWAP_V3_FACTORY_ADDRESS)
  );

  let tryUsdcPoolAddress = factory.try_getPool(
    Address.fromString(WETH_ADDRESS),
    Address.fromString(USDC_ADDRESS),
    3000
  );

  if (tryUsdcPoolAddress.reverted) {
    throw new Error("No USDC pool found");
  }
  const usdcPoolAddress = tryUsdcPoolAddress.value;

  let usdcPool = UniswapV3Pool.bind(usdcPoolAddress);

  const tokenPrices = sqrtPriceX96ToTokenPrices(
    usdcPool.slot0().value0,
    ERC20.bind(usdcPool.token0()),
    ERC20.bind(usdcPool.token1())
  );

  if (
    usdcPool.token0().toHexString().toLowerCase() == WETH_ADDRESS.toLowerCase()
  ) {
    return tokenPrices[1];
  }

  return tokenPrices[0];
}

export function getTokenPriceUSD(tokenAddress: string): BigDecimal {
  const ethPriceUSD = getEthPriceInUSD();

  const derivedEth = findEthPerToken(tokenAddress);

  if (
    tokenAddress.toLowerCase() == WETH_ADDRESS.toLowerCase() ||
    tokenAddress.toLowerCase() ==
      constants.ADDRESS_ZERO.toHexString().toLowerCase()
  ) {
    return ethPriceUSD;
  }

  return derivedEth.times(ethPriceUSD);
}

// Derives token price in ETH terms by using either the token / WETH pool,
// or a whitelisted tokens WETH pool.
function findEthPerToken(tokenAddress: string): BigDecimal {
  // hardcode sepolia price
  if (isTestnet) return BigDecimal.fromString("0.00064");

  const uniswapFactory = UniswapV3Factory.bind(
    Address.fromString(UNISWAP_V3_FACTORY_ADDRESS)
  );

  if (tokenAddress.toLowerCase() == WETH_ADDRESS.toLowerCase()) {
    return BigDecimal.fromString("1");
  }

  for (let i = 0; i < TOKEN_WHITELIST.length; i++) {
    const tryPoolAddress = uniswapFactory.try_getPool(
      Address.fromString(tokenAddress),
      Address.fromString(TOKEN_WHITELIST[i]),
      3000
    );

    if (tryPoolAddress.reverted) continue; // try next token
    const poolAddress = tryPoolAddress.value;

    if (
      poolAddress.toHexString().toLowerCase() !=
      constants.ADDRESS_ZERO.toHexString().toLowerCase()
    ) {
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
