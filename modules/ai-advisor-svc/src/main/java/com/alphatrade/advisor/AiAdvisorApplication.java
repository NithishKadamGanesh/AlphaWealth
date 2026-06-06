package com.alphatrade.advisor;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.*;

/**
 * AI Advisor Service - Multi-model with provider switching.
 *
 * RAG context sources:
 *   - net-worth-svc          : net worth + asset breakdown
 *   - ibkr-sync-svc          : real IBKR positions
 *   - teller-banking-svc     : last 30d Teller (bank) transactions
 *   - analysis-svc           : technical signal + multi-timeframe + patterns
 *   - sentiment-svc          : FinBERT news sentiment per symbol
 *   - fingpt-svc             : FinGPT-Forecaster (opt-in, slow)
 *   - cpp-signal-engine      : C++ market regime classification (Phase 2)
 */
@SpringBootApplication
public class AiAdvisorApplication {
    public static void main(String[] args) {
        SpringApplication.run(AiAdvisorApplication.class, args);
    }

    @Bean
    public WebClient webClient() {
        return WebClient.builder()
                .codecs(c -> c.defaultCodecs().maxInMemorySize(8 * 1024 * 1024))
                .build();
    }
}

@Data
class ChatRequest {
    private List<Map<String, Object>> messages;
    private String userId = "default";
    private List<String> watchSymbols = List.of("AAPL", "NVDA", "MSFT", "VOO");
    private String provider;
    private boolean includeForecast = false;  // FinGPT forecasts are slow (~5s each)
}

@Slf4j
@RestController
@RequestMapping("/")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
class AdvisorController {

    private final WebClient webClient;
    private final ObjectMapper mapper;

    @Value("${llm.provider:auto}")          private String defaultProvider;
    @Value("${anthropic.api-key:}")         private String anthropicKey;
    @Value("${anthropic.model:claude-sonnet-4-20250514}") private String anthropicModel;
    @Value("${openai.api-key:}")            private String openaiKey;
    @Value("${openai.model:gpt-4o-mini}")   private String openaiModel;
    @Value("${gemini.api-key:}")            private String geminiKey;
    @Value("${gemini.model:gemini-2.0-flash-exp}") private String geminiModel;
    @Value("${ollama.url:http://ollama:11434}")    private String ollamaUrl;
    @Value("${ollama.model:llama3.1:8b-instruct-q5_K_M}") private String ollamaModel;

    @Value("${services.net-worth:http://net-worth-svc:8093}")  private String netWorthUrl;
    @Value("${services.ibkr:http://ibkr-sync-svc:8091}")       private String ibkrUrl;
    @Value("${services.teller:http://teller-banking-svc:8092}")  private String tellerUrl;
    @Value("${services.analysis:http://analysis-svc:8088}")    private String analysisUrl;
    @Value("${services.sentiment:http://sentiment-svc:8097}")  private String sentimentUrl;
    @Value("${services.fingpt:http://fingpt-svc:8098}")        private String fingptUrl;
    @Value("${services.live-data:http://live-data-svc:8096}")  private String liveDataUrl;
    @Value("${services.cpp-engine:http://cpp-signal-engine:9000}") private String cppEngineUrl;

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "healthy", "service", "ai-advisor-svc",
                      "provider", resolveProvider(null));
    }

    private String resolveProvider(String requested) {
        if (requested != null && !requested.isBlank()) return requested.toLowerCase();
        if ("auto".equalsIgnoreCase(defaultProvider)) {
            if (anthropicKey != null && !anthropicKey.isBlank()) return "claude";
            if (openaiKey != null && !openaiKey.isBlank()) return "openai";
            if (geminiKey != null && !geminiKey.isBlank()) return "gemini";
            return "ollama";
        }
        return defaultProvider.toLowerCase();
    }

    @GetMapping("/providers")
    public Map<String, Object> listProviders() {
        return Map.of(
            "active", resolveProvider(null),
            "default", defaultProvider,
            "available", Map.of(
                "claude", Map.of("configured", !anthropicKey.isBlank(), "model", anthropicModel,
                                 "free", false, "description", "Best reasoning, paid"),
                "openai", Map.of("configured", !openaiKey.isBlank(), "model", openaiModel,
                                 "free", false, "description", "GPT-4o-mini, paid"),
                "gemini", Map.of("configured", !geminiKey.isBlank(), "model", geminiModel,
                                 "free", true, "description", "Free tier, 15 RPM"),
                "ollama", Map.of("configured", true, "model", ollamaModel,
                                 "free", true, "description", "Local, GPU-accelerated, free")
            )
        );
    }

    @PostMapping("/chat")
    public Map<String, Object> chat(@RequestBody ChatRequest req) {
        String provider = resolveProvider(req.getProvider());
        try {
            String context = buildContext(req.getWatchSymbols(), req.isIncludeForecast());
            String systemPrompt = buildSystemPrompt(context);
            String reply = switch (provider) {
                case "claude"  -> callClaude(systemPrompt, req.getMessages());
                case "openai"  -> callOpenAI(systemPrompt, req.getMessages());
                case "gemini"  -> callGemini(systemPrompt, req.getMessages());
                case "ollama"  -> callOllama(systemPrompt, req.getMessages());
                default -> throw new IllegalArgumentException("Unknown provider: " + provider);
            };
            return Map.of(
                "reply", reply,
                "provider", provider,
                "context_size", context.length()
            );
        } catch (Exception e) {
            log.error("Chat failed via {}", provider, e);
            return Map.of(
                "error", e.getMessage(),
                "provider", provider,
                "reply", "Sorry, the " + provider + " backend had trouble: " + e.getMessage() +
                         "\n\nTry switching providers in Settings - Ollama runs locally for free."
            );
        }
    }

    /** Proxy endpoint: get FinGPT forecast for a symbol. UI calls this directly. */
    @GetMapping("/forecast/{symbol}")
    public Map<String, Object> forecast(@PathVariable String symbol) {
        try {
            JsonNode result = fetchJson(fingptUrl + "/forecast/" + symbol.toUpperCase(), 90);
            if (result == null || result.has("error"))
                return Map.of("error", "FinGPT service unavailable", "symbol", symbol);
            return mapper.convertValue(result, Map.class);
        } catch (Exception e) {
            return Map.of("error", e.getMessage(), "symbol", symbol);
        }
    }

    // ─── Phase 2: C++ regime classification ──────────────────────

    /**
     * Fetch recent closes from live-data-svc and POST them to cpp-signal-engine /regime.
     * Returns a one-line summary suitable for inclusion in the LLM prompt, or null on failure.
     */
    private String fetchRegimeLine(String symbol) {
        try {
            // 1. Get recent daily closes from yfinance bridge
            JsonNode history = fetchJson(liveDataUrl + "/history/" + symbol + "?period=3mo&interval=1d");
            if (history == null || !history.has("bars")) return null;
            JsonNode bars = history.path("bars");
            if (!bars.isArray() || bars.size() < 25) return null;

            ArrayNode closes = mapper.createArrayNode();
            for (JsonNode bar : bars) {
                double close = bar.path("close").asDouble(Double.NaN);
                if (!Double.isNaN(close)) closes.add(close);
            }
            if (closes.size() < 25) return null;

            // 2. POST to cpp-engine /regime
            ObjectNode payload = mapper.createObjectNode();
            payload.set("closes", closes);

            String resp = webClient.post()
                    .uri(cppEngineUrl + "/regime")
                    .header("Content-Type", "application/json")
                    .bodyValue(mapper.writeValueAsString(payload))
                    .retrieve().bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(3))
                    .block();
            if (resp == null) return null;

            JsonNode r = mapper.readTree(resp);
            if (r.has("error")) return null;

            // 3. Format for prompt: regime + direction + confidence + key snapshot stats
            return String.format(
                "%s, direction=%s, confidence=%.2f (vol_20=%.4f, trend_score=%.4f)",
                r.path("regime").asText("?"),
                r.path("direction").asText("?"),
                r.path("confidence").asDouble(),
                r.path("snapshot").path("volatility_20").asDouble(),
                r.path("snapshot").path("trend_score").asDouble()
            );
        } catch (Exception e) {
            // Stays at debug — the C++ engine is optional and may legitimately be offline.
            log.debug("Regime fetch for {} failed: {}", symbol, e.getMessage());
            return null;
        }
    }

    // ─── Context building ─────────────────────────────────

    /**
     * Soft cap on the RAG context length, measured in characters. The Anthropic / OpenAI
     * APIs all accept much larger inputs, but a 32K-char ceiling keeps us well under any
     * provider's context window (~8K tokens at the conservative 4 chars/token estimate)
     * and prevents an ever-growing watchlist from silently inflating cost & latency.
     */
    static final int MAX_CONTEXT_CHARS = 32_000;

    /** Package-private so it can be exercised by integration tests. */
    String buildContext(List<String> watchSymbols, boolean includeForecast) {
        StringBuilder ctx = new StringBuilder();
        ctx.append("# Live Financial Snapshot\n\n");

        try {
            JsonNode nw = fetchJson(netWorthUrl + "/networth/current");
            if (nw != null && !nw.has("error")) {
                ctx.append("## Net Worth\n");
                ctx.append("- Net Worth: $").append(nw.path("netWorth").asText()).append("\n");
                ctx.append("- Total Assets: $").append(nw.path("totalAssets").asText()).append("\n");
                ctx.append("- Liabilities: $").append(nw.path("totalLiabilities").asText()).append("\n");
                ctx.append("- Cash: $").append(nw.path("cash").asText())
                   .append(" / Investments: $").append(nw.path("investments").asText())
                   .append(" / Property: $").append(nw.path("property").asText())
                   .append(" / Retirement: $").append(nw.path("retirement").asText()).append("\n\n");
            } else {
                log.warn("AI Advisor context: net-worth-svc returned no data (url={})", netWorthUrl);
            }
        } catch (Exception e) { log.warn("Net worth context failed: {}", e.getMessage()); }

        try {
            JsonNode positions = fetchJson(ibkrUrl + "/ibkr/positions");
            if (positions != null && positions.isArray() && positions.size() > 0) {
                ctx.append("## Investment Holdings (IBKR Live)\n");
                // Cap positions to top 25 to keep context bounded
                int max = Math.min(positions.size(), 25);
                for (int i = 0; i < max; i++) {
                    JsonNode p = positions.get(i);
                    ctx.append("- ").append(p.path("symbol").asText())
                       .append(": ").append(p.path("position").asText()).append(" shares")
                       .append(" @ $").append(p.path("avgCost").asText()).append("\n");
                }
                if (positions.size() > max) {
                    ctx.append("- … and ").append(positions.size() - max).append(" more positions\n");
                }
                ctx.append("\n");
            } else {
                log.warn("AI Advisor context: ibkr-sync-svc returned no positions (url={})", ibkrUrl);
            }
        } catch (Exception e) { log.warn("IBKR context failed: {}", e.getMessage()); }

        try {
            JsonNode txs = fetchJson(tellerUrl + "/banking/transactions?days=30");
            if (txs != null && txs.isArray() && txs.size() > 0) {
                ctx.append("## Recent Spending (last 30 days)\n");
                Map<String, Double> byCategory = new HashMap<>();
                for (JsonNode tx : txs) {
                    double amt = tx.path("amount").asDouble();
                    if (amt < 0) {
                        String cat = tx.path("category").asText("Other");
                        byCategory.merge(cat, Math.abs(amt), Double::sum);
                    }
                }
                byCategory.entrySet().stream()
                        .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
                        .limit(10)
                        .forEach(e -> ctx.append("- ").append(e.getKey())
                                .append(": $").append(String.format("%.2f", e.getValue())).append("\n"));
                ctx.append("\n");
            } else {
                log.info("AI Advisor context: teller-banking-svc returned no transactions (likely no enrollment yet)");
            }
        } catch (Exception e) { log.warn("Transactions context failed: {}", e.getMessage()); }

        ctx.append("## Technical & Sentiment Analysis\n");
        int symbolsIncluded = 0;
        for (String sym : watchSymbols) {
            // Token budget: bail out before we breach the cap.
            if (ctx.length() >= MAX_CONTEXT_CHARS) {
                int remaining = watchSymbols.size() - symbolsIncluded;
                ctx.append("\n_…").append(remaining).append(" more watchlist symbols omitted to stay within context budget._\n");
                log.warn("AI Advisor context truncated: hit {} char budget after {} of {} symbols",
                        MAX_CONTEXT_CHARS, symbolsIncluded, watchSymbols.size());
                break;
            }
            symbolsIncluded++;
            try {
                JsonNode signal = fetchJson(analysisUrl + "/api/analysis/" + sym + "/signal");
                JsonNode mtf    = fetchJson(analysisUrl + "/api/analysis/" + sym + "/multitimeframe");

                ctx.append("### ").append(sym).append("\n");

                if (signal != null && !signal.has("error")) {
                    ctx.append("- Technical Signal: ").append(signal.path("action").asText("?"))
                       .append(" (confidence ").append(signal.path("confidence").asText("?")).append(")\n");
                }
                if (mtf != null && mtf.has("convergence")) {
                    ctx.append("- Multi-TF: ").append(mtf.path("convergence").asText())
                       .append(" (").append(mtf.path("convergenceScore").asText()).append(")\n");
                }

                // Phase 2: C++ regime classification (only signal of its kind in the stack)
                String regimeLine = fetchRegimeLine(sym);
                if (regimeLine != null) {
                    ctx.append("- Market Regime (C++ engine): ").append(regimeLine).append("\n");
                }

                JsonNode patterns = fetchJson(analysisUrl + "/api/analysis/" + sym + "/patterns");
                if (patterns != null && patterns.isArray() && patterns.size() > 0) {
                    ctx.append("- Patterns: ");
                    int count = 0;
                    for (JsonNode pat : patterns) {
                        if (count++ >= 3) break;
                        ctx.append(pat.path("name").asText())
                           .append(" (").append(pat.path("bias").asText()).append("); ");
                    }
                    ctx.append("\n");
                }

                JsonNode sent = fetchJson(sentimentUrl + "/sentiment/symbol/" + sym);
                if (sent != null && sent.has("aggregated") && !sent.path("aggregated").isNull()) {
                    JsonNode agg = sent.path("aggregated");
                    ctx.append("- News Sentiment (FinBERT): ").append(agg.path("label").asText())
                       .append(" score=").append(agg.path("score").asText())
                       .append(" (").append(agg.path("article_count").asText()).append(" articles, ")
                       .append(agg.path("positive_count").asText()).append(" pos / ")
                       .append(agg.path("negative_count").asText()).append(" neg)\n");
                }

                if (includeForecast) {
                    JsonNode fc = fetchJson(fingptUrl + "/forecast/" + sym, 90);
                    if (fc != null && !fc.has("error")) {
                        ctx.append("- FinGPT Forecast: ").append(fc.path("direction").asText("?"))
                           .append(" (confidence ").append(fc.path("confidence").asText("?")).append("%)\n");
                    }
                }
                ctx.append("\n");
            } catch (Exception e) {
                log.warn("Analysis context for {} failed: {}", sym, e.getMessage());
            }
        }

        return ctx.toString();
    }

    private JsonNode fetchJson(String url) { return fetchJson(url, 8); }

    private JsonNode fetchJson(String url, int timeoutSec) {
        try {
            String body = webClient.get().uri(url).retrieve().bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(timeoutSec)).block();
            return body == null ? null : mapper.readTree(body);
        } catch (Exception e) {
            return null;
        }
    }

    private String buildSystemPrompt(String context) {
        return """
                You are AlphaWealth's AI financial advisor - a personal CFO with deep knowledge of \
                investing, technical analysis, options strategy, taxes, retirement planning, and \
                personal finance. You have access to the user's REAL, LIVE financial data, real-time \
                technical analysis from a quantitative engine, FinBERT news sentiment, market regime \
                classification from a native C++ engine, and (when included) FinGPT-Forecaster \
                directional predictions.

                Be specific. Cite the user's actual numbers. Reference specific signals, patterns, \
                indicators, regime labels, sentiment scores, and forecasts when relevant. Be concise \
                but thorough. For investment questions, lean conservative and remind the user that \
                markets are uncertain.

                """ + context + """

                Guidelines:
                - Reference specific holdings, balances, and spending categories
                - Use exact dollar figures and percentages from the context
                - Use the regime label (BULL_TREND / BEAR_TREND / RANGING / HIGH_VOL) to frame technical commentary
                - When forecasts contradict technical signals or regime, point out the disagreement explicitly
                - Note that this is general financial guidance, not personalized investment advice
                """;
    }

    // ─── Provider implementations ────────────────────────────

    private String callClaude(String systemPrompt, List<Map<String, Object>> messages) throws Exception {
        if (anthropicKey == null || anthropicKey.isBlank())
            throw new RuntimeException("ANTHROPIC_API_KEY not set. Use Settings to switch to Ollama (free).");

        ObjectNode payload = mapper.createObjectNode();
        payload.put("model", anthropicModel);
        payload.put("max_tokens", 2048);
        payload.put("system", systemPrompt);

        ArrayNode msgs = payload.putArray("messages");
        for (Map<String, Object> m : messages) {
            ObjectNode msg = mapper.createObjectNode();
            msg.put("role", String.valueOf(m.get("role")));
            msg.put("content", String.valueOf(m.get("content")));
            msgs.add(msg);
        }

        String resp = webClient.post()
                .uri("https://api.anthropic.com/v1/messages")
                .header("x-api-key", anthropicKey)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .bodyValue(mapper.writeValueAsString(payload))
                .retrieve().bodyToMono(String.class)
                .timeout(Duration.ofSeconds(60)).block();

        JsonNode tree = mapper.readTree(resp);
        if (tree.has("error")) throw new RuntimeException("Claude: " + tree.get("error").toString());
        StringBuilder out = new StringBuilder();
        for (JsonNode block : tree.path("content")) {
            if ("text".equals(block.path("type").asText())) out.append(block.path("text").asText());
        }
        return out.toString();
    }

    private String callOpenAI(String systemPrompt, List<Map<String, Object>> messages) throws Exception {
        if (openaiKey == null || openaiKey.isBlank()) throw new RuntimeException("OPENAI_API_KEY not set");
        ObjectNode payload = mapper.createObjectNode();
        payload.put("model", openaiModel);
        payload.put("max_tokens", 2048);
        ArrayNode msgs = payload.putArray("messages");
        ObjectNode sys = mapper.createObjectNode();
        sys.put("role", "system"); sys.put("content", systemPrompt); msgs.add(sys);
        for (Map<String, Object> m : messages) {
            ObjectNode msg = mapper.createObjectNode();
            msg.put("role", String.valueOf(m.get("role")));
            msg.put("content", String.valueOf(m.get("content")));
            msgs.add(msg);
        }
        String resp = webClient.post()
                .uri("https://api.openai.com/v1/chat/completions")
                .header("Authorization", "Bearer " + openaiKey).header("Content-Type", "application/json")
                .bodyValue(mapper.writeValueAsString(payload))
                .retrieve().bodyToMono(String.class)
                .timeout(Duration.ofSeconds(60)).block();
        JsonNode tree = mapper.readTree(resp);
        if (tree.has("error")) throw new RuntimeException("OpenAI: " + tree.get("error").toString());
        return tree.path("choices").path(0).path("message").path("content").asText("");
    }

    private String callGemini(String systemPrompt, List<Map<String, Object>> messages) throws Exception {
        if (geminiKey == null || geminiKey.isBlank()) throw new RuntimeException("GEMINI_API_KEY not set");
        ObjectNode payload = mapper.createObjectNode();
        ArrayNode contents = payload.putArray("contents");
        ObjectNode sysInstr = mapper.createObjectNode();
        ArrayNode sysParts = sysInstr.putArray("parts");
        ObjectNode sysPart = mapper.createObjectNode();
        sysPart.put("text", systemPrompt);
        sysParts.add(sysPart);
        payload.set("system_instruction", sysInstr);
        for (Map<String, Object> m : messages) {
            ObjectNode content = mapper.createObjectNode();
            content.put("role", "user".equals(m.get("role")) ? "user" : "model");
            ArrayNode parts = content.putArray("parts");
            ObjectNode part = mapper.createObjectNode();
            part.put("text", String.valueOf(m.get("content")));
            parts.add(part);
            contents.add(content);
        }
        String resp = webClient.post()
                .uri("https://generativelanguage.googleapis.com/v1beta/models/" + geminiModel + ":generateContent?key=" + geminiKey)
                .header("Content-Type", "application/json")
                .bodyValue(mapper.writeValueAsString(payload))
                .retrieve().bodyToMono(String.class)
                .timeout(Duration.ofSeconds(60)).block();
        JsonNode tree = mapper.readTree(resp);
        if (tree.has("error")) throw new RuntimeException("Gemini: " + tree.get("error").toString());
        return tree.path("candidates").path(0).path("content").path("parts").path(0).path("text").asText("");
    }

    private String callOllama(String systemPrompt, List<Map<String, Object>> messages) throws Exception {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("model", ollamaModel);
        payload.put("stream", false);
        ArrayNode msgs = payload.putArray("messages");
        ObjectNode sys = mapper.createObjectNode();
        sys.put("role", "system"); sys.put("content", systemPrompt); msgs.add(sys);
        for (Map<String, Object> m : messages) {
            ObjectNode msg = mapper.createObjectNode();
            msg.put("role", String.valueOf(m.get("role")));
            msg.put("content", String.valueOf(m.get("content")));
            msgs.add(msg);
        }
        ObjectNode options = payload.putObject("options");
        options.put("temperature", 0.7);
        options.put("num_predict", 2048);
        String resp = webClient.post()
                .uri(ollamaUrl + "/api/chat")
                .header("Content-Type", "application/json")
                .bodyValue(mapper.writeValueAsString(payload))
                .retrieve().bodyToMono(String.class)
                .timeout(Duration.ofSeconds(120)).block();
        JsonNode tree = mapper.readTree(resp);
        if (tree.has("error")) throw new RuntimeException("Ollama: " + tree.path("error").asText());
        return tree.path("message").path("content").asText("");
    }
}
