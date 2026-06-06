package com.alphatrade.advisor;

import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.mockwebserver.Dispatcher;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration smoke test for AdvisorController.buildContext().
 *
 * Why this test exists:
 *   The advisor's RAG pipeline pulls from 7 backing services. fetchJson() is
 *   fail-soft - any individual service returning bad data, timing out, or
 *   crashing causes that section to be silently dropped. This is good for
 *   resilience but bad for verifiability: a regression that quietly removes
 *   the regime line, or breaks the JSON shape parsing, would never surface
 *   from manual UI testing.
 *
 *   This test boots one MockWebServer per backing service, programs canned
 *   responses that match the real API shapes, and asserts that the assembled
 *   prompt contains every expected section. If any section disappears, the
 *   test fails immediately.
 *
 * Coverage:
 *   - Net worth section appears with the right numbers
 *   - IBKR positions section appears
 *   - Teller spending categories appear
 *   - Per-symbol: technical signal, multi-timeframe, patterns, FinBERT, regime
 *   - When includeForecast=false, FinGPT is NOT called (saves ~5s/symbol)
 *   - When includeForecast=true, FinGPT line appears
 *   - When a backing service fails, other sections still render (graceful)
 */
class AdvisorContextIntegrationTest {

    private MockWebServer netWorth;
    private MockWebServer ibkr;
    private MockWebServer teller;
    private MockWebServer analysis;
    private MockWebServer sentiment;
    private MockWebServer fingpt;
    private MockWebServer liveData;
    private MockWebServer cppEngine;

    private AdvisorController controller;

    @BeforeEach
    void setUp() throws IOException {
        netWorth  = new MockWebServer(); netWorth.start();
        ibkr      = new MockWebServer(); ibkr.start();
        teller     = new MockWebServer(); teller.start();
        analysis  = new MockWebServer(); analysis.start();
        sentiment = new MockWebServer(); sentiment.start();
        fingpt    = new MockWebServer(); fingpt.start();
        liveData  = new MockWebServer(); liveData.start();
        cppEngine = new MockWebServer(); cppEngine.start();

        WebClient webClient = WebClient.builder()
                .codecs(c -> c.defaultCodecs().maxInMemorySize(8 * 1024 * 1024))
                .build();
        ObjectMapper mapper = new ObjectMapper();

        controller = new AdvisorController(webClient, mapper);

        // Inject mock URLs into all the @Value-bound fields
        ReflectionTestUtils.setField(controller, "netWorthUrl",  url(netWorth));
        ReflectionTestUtils.setField(controller, "ibkrUrl",      url(ibkr));
        ReflectionTestUtils.setField(controller, "tellerUrl",     url(teller));
        ReflectionTestUtils.setField(controller, "analysisUrl",  url(analysis));
        ReflectionTestUtils.setField(controller, "sentimentUrl", url(sentiment));
        ReflectionTestUtils.setField(controller, "fingptUrl",    url(fingpt));
        ReflectionTestUtils.setField(controller, "liveDataUrl",  url(liveData));
        ReflectionTestUtils.setField(controller, "cppEngineUrl", url(cppEngine));

        // Other @Value fields the controller expects
        ReflectionTestUtils.setField(controller, "defaultProvider", "ollama");
        ReflectionTestUtils.setField(controller, "anthropicKey", "");
        ReflectionTestUtils.setField(controller, "anthropicModel", "claude-sonnet-4-20250514");
        ReflectionTestUtils.setField(controller, "openaiKey", "");
        ReflectionTestUtils.setField(controller, "openaiModel", "gpt-4o-mini");
        ReflectionTestUtils.setField(controller, "geminiKey", "");
        ReflectionTestUtils.setField(controller, "geminiModel", "gemini-2.0-flash-exp");
        ReflectionTestUtils.setField(controller, "ollamaUrl", "http://localhost:11434");
        ReflectionTestUtils.setField(controller, "ollamaModel", "llama3.1:8b");
    }

    @AfterEach
    void tearDown() throws IOException {
        for (MockWebServer s : List.of(netWorth, ibkr, teller, analysis, sentiment, fingpt, liveData, cppEngine)) {
            s.shutdown();
        }
    }

    private static String url(MockWebServer s) {
        // strip trailing slash so concatenation matches the production URL shapes
        String u = s.url("/").toString();
        return u.substring(0, u.length() - 1);
    }

    @Test
    void buildContext_includesAllSectionsWhenAllServicesHealthy() {
        netWorth.setDispatcher(staticDispatcher("""
            {"netWorth":250000,"totalAssets":300000,"totalLiabilities":50000,
             "cash":15000,"investments":120000,"property":150000,"retirement":15000,
             "crypto":0,"otherAssets":0,"timestamp":"2026-05-06T10:00:00Z"}
            """));

        ibkr.setDispatcher(staticDispatcher("""
            [{"symbol":"AAPL","secType":"STK","position":"50","avgCost":"180.50","currency":"USD"},
             {"symbol":"NVDA","secType":"STK","position":"10","avgCost":"700.00","currency":"USD"}]
            """));

        teller.setDispatcher(staticDispatcher("""
            [{"merchant":"Whole Foods","category":"Groceries","amount":-87.50,"date":"2026-05-01"},
             {"merchant":"Shell","category":"Gas","amount":-45.20,"date":"2026-05-02"},
             {"merchant":"Direct Deposit","category":"Income","amount":4500.00,"date":"2026-05-01"}]
            """));

        // analysis-svc has multiple endpoints per symbol
        analysis.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                String path = request.getPath() == null ? "" : request.getPath();
                if (path.endsWith("/signal")) {
                    return jsonResponse("""
                        {"action":"BUY","confidence":"0.75","regime":"TRENDING"}
                        """);
                } else if (path.endsWith("/multitimeframe")) {
                    return jsonResponse("""
                        {"convergence":"STRONG_BUY","convergenceScore":"0.82"}
                        """);
                } else if (path.endsWith("/patterns")) {
                    return jsonResponse("""
                        [{"name":"Double Bottom","bias":"BULLISH","confidence":0.7},
                         {"name":"Hammer","bias":"BULLISH","confidence":0.6}]
                        """);
                }
                return new MockResponse().setResponseCode(404);
            }
        });

        sentiment.setDispatcher(staticDispatcher("""
            {"symbol":"AAPL","articles":[],
             "aggregated":{"label":"positive","score":0.65,"article_count":12,
                           "positive_count":8,"negative_count":2,"neutral_count":2}}
            """));

        // live-data-svc returns 60 daily bars (enough for regime analysis which requires >=25)
        liveData.setDispatcher(staticDispatcher(generateBarsJson(60)));

        // cpp-signal-engine /regime
        cppEngine.setDispatcher(staticDispatcher("""
            {"regime":"BULL_TREND","direction":"UP","confidence":0.62,
             "snapshot":{"momentum_5":0.012,"momentum_20":0.045,
                         "volatility_20":0.018,"trend_score":0.082}}
            """));

        String ctx = controller.buildContext(List.of("AAPL"), false);

        // Net worth
        assertThat(ctx).contains("Net Worth");
        assertThat(ctx).contains("250000");
        assertThat(ctx).contains("Total Assets: $300000");

        // IBKR positions
        assertThat(ctx).contains("Investment Holdings (IBKR Live)");
        assertThat(ctx).contains("AAPL");
        assertThat(ctx).contains("180.50");

        // Spending categories
        assertThat(ctx).contains("Recent Spending");
        assertThat(ctx).contains("Groceries");

        // Per-symbol technical
        assertThat(ctx).contains("Technical Signal: BUY");
        assertThat(ctx).contains("Multi-TF: STRONG_BUY");
        assertThat(ctx).contains("Patterns:");
        assertThat(ctx).contains("Double Bottom");

        // FinBERT sentiment
        assertThat(ctx).contains("News Sentiment (FinBERT): positive");
        assertThat(ctx).contains("12 articles");

        // Phase 2: C++ regime line
        assertThat(ctx).contains("Market Regime (C++ engine)");
        assertThat(ctx).contains("BULL_TREND");
        assertThat(ctx).contains("direction=UP");

        // FinGPT NOT called (includeForecast=false)
        assertThat(ctx).doesNotContain("FinGPT Forecast");
        assertThat(fingpt.getRequestCount()).isEqualTo(0);
    }

    @Test
    void buildContext_includesFinGPTLineWhenOptedIn() {
        // Minimal stubs - just enough to render the symbol section
        netWorth.setDispatcher(staticDispatcher("{\"netWorth\":1,\"totalAssets\":1,\"totalLiabilities\":0,\"cash\":0,\"investments\":0,\"property\":0,\"retirement\":0,\"crypto\":0,\"otherAssets\":0}"));
        ibkr.setDispatcher(staticDispatcher("[]"));
        teller.setDispatcher(staticDispatcher("[]"));
        analysis.setDispatcher(notFoundDispatcher());
        sentiment.setDispatcher(notFoundDispatcher());
        liveData.setDispatcher(notFoundDispatcher());
        cppEngine.setDispatcher(notFoundDispatcher());

        fingpt.setDispatcher(staticDispatcher("""
            {"symbol":"AAPL","direction":"BULLISH","confidence":72,
             "analysis":"Recent uptrend continues","model":"FinGPT-Forecaster",
             "computed_at":"2026-05-06T10:00:00Z"}
            """));

        String ctx = controller.buildContext(List.of("AAPL"), true);

        assertThat(ctx).contains("FinGPT Forecast: BULLISH");
        assertThat(ctx).contains("confidence 72");
        assertThat(fingpt.getRequestCount()).isEqualTo(1);
    }

    @Test
    void buildContext_gracefullyDegradesWhenServicesAreDown() {
        // All services return 503 except net-worth
        netWorth.setDispatcher(staticDispatcher("""
            {"netWorth":100,"totalAssets":100,"totalLiabilities":0,
             "cash":50,"investments":50,"property":0,"retirement":0,
             "crypto":0,"otherAssets":0}
            """));
        ibkr.setDispatcher(errorDispatcher(503));
        teller.setDispatcher(errorDispatcher(503));
        analysis.setDispatcher(errorDispatcher(503));
        sentiment.setDispatcher(errorDispatcher(503));
        fingpt.setDispatcher(errorDispatcher(503));
        liveData.setDispatcher(errorDispatcher(503));
        cppEngine.setDispatcher(errorDispatcher(503));

        // Should not throw - this is the whole point of fail-soft fetchJson
        String ctx = controller.buildContext(List.of("AAPL", "MSFT"), false);

        // Net worth still rendered
        assertThat(ctx).contains("Net Worth");

        // Sections backed by failing services are absent
        assertThat(ctx).doesNotContain("Investment Holdings");
        assertThat(ctx).doesNotContain("Recent Spending");
        assertThat(ctx).doesNotContain("Market Regime");

        // Empty technical section header is OK; symbol headers may or may not render
        // depending on whether any sub-call succeeded. Either way, no crash.
    }

    @Test
    void buildContext_skipsRegimeWhenInsufficientHistoryBars() {
        netWorth.setDispatcher(staticDispatcher("""
            {"netWorth":1,"totalAssets":1,"totalLiabilities":0,"cash":0,"investments":0,
             "property":0,"retirement":0,"crypto":0,"otherAssets":0}
            """));
        ibkr.setDispatcher(staticDispatcher("[]"));
        teller.setDispatcher(staticDispatcher("[]"));
        analysis.setDispatcher(notFoundDispatcher());
        sentiment.setDispatcher(notFoundDispatcher());

        // Only 10 bars - below the 25-bar minimum for regime analysis
        liveData.setDispatcher(staticDispatcher(generateBarsJson(10)));
        // Even if cpp-engine were called, we want no regime line in output
        cppEngine.setDispatcher(notFoundDispatcher());

        String ctx = controller.buildContext(List.of("AAPL"), false);

        assertThat(ctx).doesNotContain("Market Regime");
        // cpp-engine should NOT have been called - we short-circuit when bars < 25
        assertThat(cppEngine.getRequestCount()).isEqualTo(0);
    }

    // ─── Helpers ─────────────────────────────────────────────

    private static MockResponse jsonResponse(String body) {
        return new MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "application/json")
                .setBody(body);
    }

    private static Dispatcher staticDispatcher(String body) {
        return new Dispatcher() {
            @Override public MockResponse dispatch(RecordedRequest request) {
                return jsonResponse(body);
            }
        };
    }

    private static Dispatcher errorDispatcher(int code) {
        return new Dispatcher() {
            @Override public MockResponse dispatch(RecordedRequest request) {
                return new MockResponse().setResponseCode(code);
            }
        };
    }

    private static Dispatcher notFoundDispatcher() {
        return errorDispatcher(404);
    }

    /**
     * Generate a JSON document mimicking live-data-svc /history response with N bars.
     * Closes follow a mild upward drift so analyze_regime() returns BULL_TREND.
     */
    private static String generateBarsJson(int n) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"symbol\":\"AAPL\",\"period\":\"3mo\",\"interval\":\"1d\",\"bars\":[");
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(",");
            double close = 150.0 + i * 0.4 + (i % 5 == 0 ? 0.8 : -0.3);
            sb.append(String.format(
                "{\"date\":\"2026-03-%02d\",\"open\":%.2f,\"high\":%.2f,\"low\":%.2f,\"close\":%.2f,\"volume\":1000000}",
                (i % 28) + 1, close - 0.5, close + 1.0, close - 1.0, close
            ));
        }
        sb.append("]}");
        return sb.toString();
    }
}
