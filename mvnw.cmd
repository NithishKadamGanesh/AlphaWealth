@echo off
setlocal

set "MAVEN_VERSION=3.9.9"
set "MAVEN_HOME=%~dp0.mvn\maven"
set "MAVEN_ZIP=%~dp0.mvn\wrapper\apache-maven-%MAVEN_VERSION%-bin.zip"
set "MVN_CMD=%MAVEN_HOME%\apache-maven-%MAVEN_VERSION%\bin\mvn.cmd"

:: Check if Java is available
java -version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Java is not installed or not on PATH.
    echo Install Java 21: winget install Microsoft.OpenJDK.21
    echo Then reopen this terminal and try again.
    exit /b 1
)

:: Check if Maven is already downloaded
if exist "%MVN_CMD%" goto :run

echo [INFO] Maven not found locally. Downloading Maven %MAVEN_VERSION%...
mkdir "%MAVEN_HOME%" 2>nul

:: Download Maven using PowerShell
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/%MAVEN_VERSION%/apache-maven-%MAVEN_VERSION%-bin.zip' -OutFile '%MAVEN_ZIP%' }"

if not exist "%MAVEN_ZIP%" (
    echo [ERROR] Failed to download Maven. Check your internet connection.
    exit /b 1
)

echo [INFO] Extracting Maven...
powershell -Command "Expand-Archive -Path '%MAVEN_ZIP%' -DestinationPath '%MAVEN_HOME%' -Force"

if not exist "%MVN_CMD%" (
    echo [ERROR] Maven extraction failed.
    exit /b 1
)

echo [INFO] Maven %MAVEN_VERSION% installed to %MAVEN_HOME%
del "%MAVEN_ZIP%" 2>nul

:run
"%MVN_CMD%" %*
