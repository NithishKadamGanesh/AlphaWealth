@echo off
title AlphaTrade Engine - Shutdown
echo.
echo Stopping all AlphaTrade services...
echo.

taskkill /fi "windowtitle eq AT-Gateway-8081*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-Risk-8082*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-MatchEngine-8083*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-Portfolio-8084*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-GraphQL-8085*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-UI-3000*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-MarketData-8087*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-Analysis-8088*" /f >nul 2>&1
taskkill /fi "windowtitle eq AT-Backtest-8089*" /f >nul 2>&1

echo [OK] All application services stopped.
echo.

set /p INFRA="Stop infrastructure too (Redpanda, Postgres, Redis)? [y/N]: "
if /i "%INFRA%"=="y" (
    cd /d "%~dp0"
    docker compose down
    echo [OK] Infrastructure stopped.
)

echo.
echo Done.
pause
