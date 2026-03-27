#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# AlphaTrade Engine — Smoke Test Script
# Submits a matching BUY and SELL LIMIT order, waits for fills,
# then queries positions and trades via GraphQL.
# =============================================================================

GATEWAY="http://localhost:8081"
GRAPHQL="http://localhost:8085"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        AlphaTrade Engine — Smoke Test                ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ---------------------------------------------------------------------------
# 1. Submit a LIMIT BUY order
# ---------------------------------------------------------------------------
echo "▸ Submitting LIMIT BUY: AAPL 100 @ 150.00 ..."
BUY_RESPONSE=$(curl -s -X POST "${GATEWAY}/api/v1/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "TRADER-ALPHA",
    "symbol": "AAPL",
    "side": "BUY",
    "type": "LIMIT",
    "qty": 100,
    "price": 150.00,
    "timeInForce": "DAY"
  }')
echo "  Response: ${BUY_RESPONSE}"
echo ""

# Give the pipeline a moment to process through risk
sleep 2

# ---------------------------------------------------------------------------
# 2. Submit a LIMIT SELL order that crosses the BUY
# ---------------------------------------------------------------------------
echo "▸ Submitting LIMIT SELL: AAPL 100 @ 150.00 (should match) ..."
SELL_RESPONSE=$(curl -s -X POST "${GATEWAY}/api/v1/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "TRADER-BETA",
    "symbol": "AAPL",
    "side": "SELL",
    "type": "LIMIT",
    "qty": 100,
    "price": 150.00,
    "timeInForce": "DAY"
  }')
echo "  Response: ${SELL_RESPONSE}"
echo ""

# Wait for matching + portfolio persistence
sleep 3

# ---------------------------------------------------------------------------
# 3. Submit additional orders to build the book
# ---------------------------------------------------------------------------
echo "▸ Submitting additional orders to build depth..."

# Bids at various levels
for PRICE in 149.50 149.00 148.50 148.00; do
  curl -s -X POST "${GATEWAY}/api/v1/orders" \
    -H "Content-Type: application/json" \
    -d "{
      \"clientId\": \"TRADER-ALPHA\",
      \"symbol\": \"AAPL\",
      \"side\": \"BUY\",
      \"type\": \"LIMIT\",
      \"qty\": 200,
      \"price\": ${PRICE},
      \"timeInForce\": \"DAY\"
    }" > /dev/null
  echo "  BUY 200 @ ${PRICE}"
done

# Asks at various levels
for PRICE in 150.50 151.00 151.50 152.00; do
  curl -s -X POST "${GATEWAY}/api/v1/orders" \
    -H "Content-Type: application/json" \
    -d "{
      \"clientId\": \"TRADER-BETA\",
      \"symbol\": \"AAPL\",
      \"side\": \"SELL\",
      \"type\": \"LIMIT\",
      \"qty\": 150,
      \"price\": ${PRICE},
      \"timeInForce\": \"DAY\"
    }" > /dev/null
  echo "  SELL 150 @ ${PRICE}"
done

echo ""
sleep 2

# ---------------------------------------------------------------------------
# 4. Submit a crossing MARKET order
# ---------------------------------------------------------------------------
echo "▸ Submitting MARKET BUY: AAPL 50 (should match best ask @ 150.50) ..."
curl -s -X POST "${GATEWAY}/api/v1/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "TRADER-ALPHA",
    "symbol": "AAPL",
    "side": "BUY",
    "type": "MARKET",
    "qty": 50,
    "timeInForce": "IOC"
  }' | python3 -m json.tool 2>/dev/null || true
echo ""

sleep 3

# ---------------------------------------------------------------------------
# 5. Query positions via GraphQL
# ---------------------------------------------------------------------------
echo "▸ Querying positions via GraphQL ..."
curl -s -X POST "${GRAPHQL}/graphql" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ positions { accountId symbol qty avgPx realizedPnl totalBuyQty totalSellQty } }"
  }' | python3 -m json.tool 2>/dev/null || true
echo ""

# ---------------------------------------------------------------------------
# 6. Query trades via GraphQL
# ---------------------------------------------------------------------------
echo "▸ Querying trades via GraphQL ..."
curl -s -X POST "${GRAPHQL}/graphql" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ trades { tradeId orderId accountId symbol side qty price ts } }"
  }' | python3 -m json.tool 2>/dev/null || true
echo ""

# ---------------------------------------------------------------------------
# 7. Test risk rejection (qty = -1)
# ---------------------------------------------------------------------------
echo "▸ Testing risk rejection (negative qty) ..."
curl -s -X POST "${GATEWAY}/api/v1/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "TRADER-ALPHA",
    "symbol": "AAPL",
    "side": "BUY",
    "type": "LIMIT",
    "qty": -1,
    "price": 150.00,
    "timeInForce": "DAY"
  }' | python3 -m json.tool 2>/dev/null || true
echo ""

echo "╔══════════════════════════════════════════════════════╗"
echo "║        Smoke test complete!                          ║"
echo "║  UI: http://localhost:3000                           ║"
echo "║  GraphiQL: http://localhost:8085/graphiql             ║"
echo "╚══════════════════════════════════════════════════════╝"
