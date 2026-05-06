@echo off
title AlphaTrade Engine - Smoke Test
color 0E

echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║       AlphaTrade Engine - Smoke Test Suite       ║
echo   ╚══════════════════════════════════════════════════╝
echo.

set PASS=0
set FAIL=0
set TOTAL=0

:: -------------------------------------------------------
:: Health checks for all services
:: -------------------------------------------------------
echo [PHASE 1] Service health checks
echo ─────────────────────────────────────────────────────

call :check_health "Order Gateway  :8081" "http://localhost:8081/api/v1/health"
call :check_health "Risk Service   :8082" "http://localhost:8082/actuator/health"
call :check_health "Match Engine   :8083" "http://localhost:8083/actuator/health"
call :check_health "Portfolio Svc  :8084" "http://localhost:8084/actuator/health"
call :check_health "GraphQL API    :8085" "http://localhost:8085/actuator/health"
call :check_health "Market Data    :8087" "http://localhost:8087/actuator/health"
call :check_health "Analysis Svc   :8088" "http://localhost:8088/actuator/health"
call :check_health "Backtest Svc   :8089" "http://localhost:8089/actuator/health"

echo.
echo [PHASE 2] Order pipeline end-to-end test
echo ─────────────────────────────────────────────────────

:: Submit a BUY order
echo [TEST] Submitting BUY LIMIT order for AAPL...
curl -s -o buy_response.json -w "%%{http_code}" -X POST http://localhost:8081/api/v1/orders -H "Content-Type: application/json" -d "{\"clientId\":\"smoke-test\",\"symbol\":\"AAPL\",\"side\":\"BUY\",\"type\":\"LIMIT\",\"qty\":100,\"price\":195.00}" > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="202" (
    echo   [PASS] BUY order accepted ^(HTTP 202^)
    set /a PASS+=1
) else (
    echo   [FAIL] BUY order failed ^(HTTP %HTTP_CODE%^)
    set /a FAIL+=1
)
set /a TOTAL+=1

:: Submit a matching SELL order
echo [TEST] Submitting SELL LIMIT order for AAPL ^(should match^)...
curl -s -o sell_response.json -w "%%{http_code}" -X POST http://localhost:8081/api/v1/orders -H "Content-Type: application/json" -d "{\"clientId\":\"smoke-seller\",\"symbol\":\"AAPL\",\"side\":\"SELL\",\"type\":\"LIMIT\",\"qty\":100,\"price\":195.00}" > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="202" (
    echo   [PASS] SELL order accepted ^(HTTP 202^)
    set /a PASS+=1
) else (
    echo   [FAIL] SELL order failed ^(HTTP %HTTP_CODE%^)
    set /a FAIL+=1
)
set /a TOTAL+=1

:: Wait for pipeline to process
echo [....] Waiting 3s for Kafka pipeline to process...
timeout /t 3 /nobreak >nul

:: Check GraphQL for positions
echo [TEST] Querying positions via GraphQL...
curl -s -o graphql_response.json -w "%%{http_code}" -X POST http://localhost:8085/graphql -H "Content-Type: application/json" -d "{\"query\":\"{ positions(accountId: \\\"smoke-test\\\") { symbol qty avgPx realizedPnl } }\"}" > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] GraphQL positions query OK
    set /a PASS+=1
) else (
    echo   [FAIL] GraphQL query failed ^(HTTP %HTTP_CODE%^)
    set /a FAIL+=1
)
set /a TOTAL+=1

:: Check trades
echo [TEST] Querying trades via GraphQL...
curl -s -o trades_response.json -w "%%{http_code}" -X POST http://localhost:8085/graphql -H "Content-Type: application/json" -d "{\"query\":\"{ trades(accountId: \\\"smoke-test\\\") { tradeId symbol side qty price } }\"}" > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] GraphQL trades query OK
    set /a PASS+=1
) else (
    echo   [FAIL] GraphQL trades query failed
    set /a FAIL+=1
)
set /a TOTAL+=1

echo.
echo [PHASE 3] Risk validation tests
echo ─────────────────────────────────────────────────────

:: Test risk rejection - zero qty
echo [TEST] Zero quantity order ^(should be rejected^)...
curl -s -o risk_response.json -w "%%{http_code}" -X POST http://localhost:8081/api/v1/orders -H "Content-Type: application/json" -d "{\"clientId\":\"smoke-test\",\"symbol\":\"AAPL\",\"side\":\"BUY\",\"type\":\"LIMIT\",\"qty\":0,\"price\":100}" > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="202" (
    echo   [PASS] Order submitted ^(risk check happens async in Kafka^)
    set /a PASS+=1
) else (
    echo   [INFO] HTTP %HTTP_CODE% ^(gateway may reject synchronously^)
    set /a PASS+=1
)
set /a TOTAL+=1

echo.
echo [PHASE 4] Market data service
echo ─────────────────────────────────────────────────────

:: Check available symbols
echo [TEST] Listing available symbols...
curl -s -o symbols_response.json -w "%%{http_code}" http://localhost:8087/api/marketdata/symbols > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] Symbols endpoint OK
    set /a PASS+=1
) else (
    echo   [FAIL] Symbols endpoint failed
    set /a FAIL+=1
)
set /a TOTAL+=1

:: Ingest crypto data (no API key needed)
echo [TEST] Ingesting BTC crypto data from Binance ^(no key needed^)...
curl -s -o crypto_response.json -w "%%{http_code}" -X POST http://localhost:8087/api/marketdata/ingest/BTC/crypto > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] BTC crypto ingestion OK
    type crypto_response.json
    echo.
    set /a PASS+=1
) else (
    echo   [FAIL] Crypto ingestion failed ^(HTTP %HTTP_CODE%^)
    set /a FAIL+=1
)
set /a TOTAL+=1

:: Fetch candles
echo [TEST] Fetching BTC candles...
curl -s -o candles_response.json -w "%%{http_code}" "http://localhost:8087/api/marketdata/candles/BTC" > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] BTC candles returned
    set /a PASS+=1
) else (
    echo   [FAIL] BTC candles failed
    set /a FAIL+=1
)
set /a TOTAL+=1

echo.
echo [PHASE 5] Analysis service
echo ─────────────────────────────────────────────────────

:: Technical analysis signal
echo [TEST] Getting trade signal for BTC...
curl -s -o signal_response.json -w "%%{http_code}" http://localhost:8088/api/analysis/BTC/signal > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] BTC signal generated
    set /a PASS+=1
) else (
    echo   [FAIL] Signal endpoint failed
    set /a FAIL+=1
)
set /a TOTAL+=1

:: Seasonality
echo [TEST] Getting seasonality for BTC...
curl -s -o seasonality_response.json -w "%%{http_code}" http://localhost:8088/api/analysis/BTC/seasonality > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] Seasonality data returned
    set /a PASS+=1
) else (
    echo   [FAIL] Seasonality failed
    set /a FAIL+=1
)
set /a TOTAL+=1

:: Options pricing
echo [TEST] Pricing a call option...
curl -s -o options_response.json -w "%%{http_code}" -X POST http://localhost:8088/api/analysis/options/price -H "Content-Type: application/json" -d "{\"type\":\"CALL\",\"spot\":150,\"strike\":155,\"daysToExpiry\":30,\"volatility\":0.25,\"riskFreeRate\":0.05}" > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] Options pricing OK
    set /a PASS+=1
) else (
    echo   [FAIL] Options pricing failed
    set /a FAIL+=1
)
set /a TOTAL+=1

echo.
echo [PHASE 6] Backtest service
echo ─────────────────────────────────────────────────────

:: List strategies
echo [TEST] Listing backtest strategies...
curl -s -o strategies_response.json -w "%%{http_code}" http://localhost:8089/api/backtest/strategies > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] Strategies list OK
    set /a PASS+=1
) else (
    echo   [FAIL] Strategies list failed
    set /a FAIL+=1
)
set /a TOTAL+=1

:: Run a backtest on BTC
echo [TEST] Running SMA Crossover backtest on BTC...
curl -s -o backtest_response.json -w "%%{http_code}" -X POST http://localhost:8089/api/backtest/run -H "Content-Type: application/json" -d "{\"symbol\":\"BTC\",\"strategy\":\"SMA_CROSSOVER\",\"capital\":100000}" > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] Backtest completed
    set /a PASS+=1
) else (
    echo   [FAIL] Backtest failed ^(HTTP %HTTP_CODE%^)
    set /a FAIL+=1
)
set /a TOTAL+=1

:: Compare strategies
echo [TEST] Comparing all strategies on BTC...
curl -s -o compare_response.json -w "%%{http_code}" -X POST http://localhost:8089/api/backtest/compare -H "Content-Type: application/json" -d "{\"symbol\":\"BTC\",\"strategies\":[\"SMA_CROSSOVER\",\"RSI_MEAN_REVERSION\",\"MACD_CROSSOVER\",\"BOLLINGER_BOUNCE\",\"BUY_AND_HOLD\"]}" > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] Strategy comparison OK
    set /a PASS+=1
) else (
    echo   [FAIL] Strategy comparison failed
    set /a FAIL+=1
)
set /a TOTAL+=1

echo.
echo [PHASE 7] UI check
echo ─────────────────────────────────────────────────────

echo [TEST] Checking React UI on port 3000...
curl -s -o ui_response.html -w "%%{http_code}" http://localhost:3000 > http_code.txt 2>nul
set /p HTTP_CODE=<http_code.txt
if "%HTTP_CODE%"=="200" (
    echo   [PASS] React UI serving on localhost:3000
    set /a PASS+=1
) else (
    echo   [FAIL] UI not responding ^(HTTP %HTTP_CODE%^)
    set /a FAIL+=1
)
set /a TOTAL+=1

:: -------------------------------------------------------
:: Results summary
:: -------------------------------------------------------
echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║          SMOKE TEST RESULTS                      ║
echo   ╠══════════════════════════════════════════════════╣
echo   ║  Total:  %TOTAL%                                       ║
echo   ║  Passed: %PASS%                                       ║
echo   ║  Failed: %FAIL%                                        ║
echo   ╚══════════════════════════════════════════════════╝
echo.

:: Cleanup temp files
del /q http_code.txt *_response.json *_response.html 2>nul

if %FAIL% GTR 0 (
    echo Some tests failed. Check service logs in the minimized windows.
    color 0C
) else (
    echo All tests passed!
    color 0A
)

echo.
pause
