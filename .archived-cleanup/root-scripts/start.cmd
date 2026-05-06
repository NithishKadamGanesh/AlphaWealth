@echo off
title AlphaTrade Engine - Launcher
color 0A

echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║       AlphaTrade Engine - Starting All           ║
echo   ╚══════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: -------------------------------------------------------
:: Step 1: Check prerequisites
:: -------------------------------------------------------
java -version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Java not found. Install: winget install Microsoft.OpenJDK.21
    echo         Then reopen terminal and try again.
    pause
    exit /b 1
)
echo [OK] Java found

where node >nul 2>&1
if errorlevel 1 (
    echo [WARN] Node.js not found - UI will not start.
    echo        Install from https://nodejs.org
    set NO_NODE=1
) else (
    echo [OK] Node.js found
)

docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running. Start Docker Desktop first.
    pause
    exit /b 1
)
echo [OK] Docker running

:: -------------------------------------------------------
:: Step 2: Start infrastructure (Redpanda, Postgres, Redis)
:: -------------------------------------------------------
echo.
echo [1/4] Starting infrastructure (Redpanda, Postgres, Redis)...
docker compose up redpanda redpanda-init postgres redis -d

echo [....] Waiting for Redpanda to be healthy (up to 30s)...
set RETRIES=0
:wait_loop
docker exec alphatrade-redpanda rpk cluster health >nul 2>&1
if not errorlevel 1 goto :infra_ready
set /a RETRIES+=1
if %RETRIES% GEQ 15 (
    echo [WARN] Redpanda may not be fully ready yet, proceeding anyway...
    goto :infra_ready
)
timeout /t 2 /nobreak >nul
goto :wait_loop

:infra_ready
echo [OK] Infrastructure is up

:: -------------------------------------------------------
:: Step 3: Build all Java modules
:: -------------------------------------------------------
echo.
echo [2/4] Building Java services (this may take 1-2 min on first run)...
call mvnw.cmd clean install -DskipTests -q
if errorlevel 1 (
    echo [ERROR] Maven build failed. Check the output above.
    pause
    exit /b 1
)
echo [OK] Build successful

:: -------------------------------------------------------
:: Step 4: Launch all 5 Java services as background processes
:: -------------------------------------------------------
echo.
echo [3/4] Starting microservices...

echo   Starting order-gateway-svc (port 8081)...
start "AT-Gateway-8081" /min cmd /c "cd /d %~dp0modules\order-gateway-svc && ..\..\mvnw.cmd spring-boot:run"

echo   Starting risk-svc (port 8082)...
start "AT-Risk-8082" /min cmd /c "cd /d %~dp0modules\risk-svc && ..\..\mvnw.cmd spring-boot:run"

echo   Starting match-engine-svc (port 8083)...
start "AT-MatchEngine-8083" /min cmd /c "cd /d %~dp0modules\match-engine-svc && ..\..\mvnw.cmd spring-boot:run"

echo   Starting portfolio-svc (port 8084)...
start "AT-Portfolio-8084" /min cmd /c "cd /d %~dp0modules\portfolio-svc && ..\..\mvnw.cmd spring-boot:run"

echo   Starting api-gw-graphql (port 8085)...
start "AT-GraphQL-8085" /min cmd /c "cd /d %~dp0modules\api-gw-graphql && ..\..\mvnw.cmd spring-boot:run"

echo   Starting market-data-svc (port 8087)...
start "AT-MarketData-8087" /min cmd /c "cd /d %~dp0modules\market-data-svc && ..\..\mvnw.cmd spring-boot:run"

echo   Starting analysis-svc (port 8088)...
start "AT-Analysis-8088" /min cmd /c "cd /d %~dp0modules\analysis-svc && ..\..\mvnw.cmd spring-boot:run"

echo   Starting backtest-svc (port 8089)...
start "AT-Backtest-8089" /min cmd /c "cd /d %~dp0modules\backtest-svc && ..\..\mvnw.cmd spring-boot:run"

:: -------------------------------------------------------
:: Step 5: Install and start the React UI
:: -------------------------------------------------------
if defined NO_NODE goto :skip_ui
echo.
echo [4/4] Starting React UI (port 3000)...
start "AT-UI-3000" /min cmd /c "cd /d %~dp0ui && npm install && npm run dev"
:skip_ui

:: -------------------------------------------------------
:: Done
:: -------------------------------------------------------
echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║       All services launching!                    ║
echo   ║                                                  ║
echo   ║   Services will be ready in ~20-30 seconds       ║
echo   ║                                                  ║
echo   ║   Trading UI:   http://localhost:3000             ║
echo   ║   GraphiQL:     http://localhost:8085/graphiql    ║
echo   ║   Order API:    http://localhost:8081/api/v1      ║
echo   ║                                                  ║
echo   ║   Each service runs in a minimized window.       ║
echo   ║   Close this window to see them in the taskbar.  ║
echo   ╚══════════════════════════════════════════════════╝
echo.

:: Wait a bit then open the browser
echo Waiting 25s for services to boot, then opening browser...
timeout /t 25 /nobreak >nul

start http://localhost:3000

echo.
echo Press any key to stop all services and exit...
pause >nul

:: -------------------------------------------------------
:: Cleanup: kill all service windows
:: -------------------------------------------------------
echo.
echo Shutting down services...
taskkill /fi "windowtitle eq AT-Gateway-8081*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-Risk-8082*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-MatchEngine-8083*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-Portfolio-8084*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-GraphQL-8085*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-UI-3000*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-MarketData-8087*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-Analysis-8088*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-Backtest-8089*" /f >nul 2>&1
echo [OK] All services stopped.
echo.
echo To also stop infrastructure: docker compose down
pause
