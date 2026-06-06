@echo off
REM Starts the IBKR Client Portal Gateway on https://localhost:5001
REM (matches IBKR_CP_GATEWAY_URL / IBKR_PUBLIC_LOGIN_URL used by ibkr-sync-svc).
REM After it starts, open https://localhost:5001 and log in with your IBKR
REM credentials + 2FA, or click "Connect IBKR" on the Portfolio page.
cd /d "%~dp0clientportal"
call bin\run.bat root\conf.yaml
