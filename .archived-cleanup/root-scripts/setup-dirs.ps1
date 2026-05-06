$base = "C:\Users\nithi\OneDrive\Desktop\alphatrade-engine\modules"

$dirs = @(
    "$base\market-data-svc\src\main\java\com\alphatrade\marketdata\client",
    "$base\market-data-svc\src\main\java\com\alphatrade\marketdata\entity",
    "$base\market-data-svc\src\main\java\com\alphatrade\marketdata\repository",
    "$base\market-data-svc\src\main\java\com\alphatrade\marketdata\service",
    "$base\market-data-svc\src\main\java\com\alphatrade\marketdata\controller",
    "$base\market-data-svc\src\main\resources",
    "$base\analysis-svc\src\main\java\com\alphatrade\analysis\indicator",
    "$base\analysis-svc\src\main\java\com\alphatrade\analysis\pattern",
    "$base\analysis-svc\src\main\java\com\alphatrade\analysis\signal",
    "$base\analysis-svc\src\main\java\com\alphatrade\analysis\seasonality",
    "$base\analysis-svc\src\main\java\com\alphatrade\analysis\controller",
    "$base\analysis-svc\src\main\java\com\alphatrade\analysis\model",
    "$base\analysis-svc\src\main\resources",
    "$base\backtest-svc\src\main\java\com\alphatrade\backtest\engine",
    "$base\backtest-svc\src\main\java\com\alphatrade\backtest\strategy",
    "$base\backtest-svc\src\main\java\com\alphatrade\backtest\controller",
    "$base\backtest-svc\src\main\java\com\alphatrade\backtest\model",
    "$base\backtest-svc\src\main\resources"
)

foreach ($d in $dirs) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

Write-Host "All directories created successfully!" -ForegroundColor Green
