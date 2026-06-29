package com.alphatrade.teller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.netty.handler.ssl.SslContext;
import io.netty.handler.ssl.SslContextBuilder;
import jakarta.annotation.PostConstruct;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.io.File;
import java.io.FileInputStream;
import java.io.RandomAccessFile;
import java.math.BigDecimal;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@SpringBootApplication
@EnableScheduling
public class TellerBankingApplication {

    public static void main(String[] args) {
        SpringApplication.run(TellerBankingApplication.class, args);
    }

    @Bean
    public WebClient tellerClient(
            @Value("${teller.cert-path:}") String certPath,
            @Value("${teller.key-path:}") String keyPath) throws Exception {

        SslContextBuilder builder = SslContextBuilder.forClient();
        if (!certPath.isBlank() && !keyPath.isBlank()) {
            File cert = new File(certPath);
            File key  = new File(keyPath);
            if (cert.exists() && cert.canRead() && key.exists() && key.canRead()) {
                validateCertExpiry(cert);
                builder.keyManager(cert, key);
                log.info("Teller mTLS certificate loaded from {}", certPath);
            } else {
                log.warn("Teller cert/key missing or unreadable at {} / {} (exists={},{} readable={},{}) — running without mTLS (sandbox only)",
                        certPath, keyPath, cert.exists(), key.exists(), cert.canRead(), key.canRead());
            }
        } else {
            log.info("Teller cert path not configured — sandbox mode");
        }

        SslContext sslContext = builder.build();
        HttpClient httpClient = HttpClient.create().secure(t -> t.sslContext(sslContext));
        return WebClient.builder()
                .baseUrl("https://api.teller.io")
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .build();
    }

    /** Read the cert and log a warning if it is expired or expires within 30 days. */
    private void validateCertExpiry(File certFile) {
        try (FileInputStream fis = new FileInputStream(certFile)) {
            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            X509Certificate cert = (X509Certificate) cf.generateCertificate(fis);
            java.util.Date notAfter = cert.getNotAfter();
            long daysLeft = ChronoUnit.DAYS.between(LocalDate.now(),
                    notAfter.toInstant().atZone(ZoneId.systemDefault()).toLocalDate());
            if (daysLeft < 0) {
                log.error("Teller mTLS cert EXPIRED on {} ({} days ago) — production API calls will fail",
                        notAfter, -daysLeft);
            } else if (daysLeft < 30) {
                log.warn("Teller mTLS cert expires in {} days (on {}) — rotate soon", daysLeft, notAfter);
            } else {
                log.info("Teller mTLS cert valid until {} ({} days)", notAfter, daysLeft);
            }
        } catch (Exception e) {
            log.warn("Could not parse Teller mTLS cert for expiry check: {}", e.getMessage());
        }
    }
}

@Data
class EnrollRequest {
    private String accessToken;
    private String institution;
}

@Slf4j
@RestController
@RequestMapping("/banking")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
class BankingController {

    private final WebClient tellerClient;
    private final KafkaTemplate<String, String> kafka;
    private final ObjectMapper mapper;

    // accessToken → institution name
    private final Map<String, String> enrollments = new ConcurrentHashMap<>();

    @Value("${teller.app-id:}")
    private String appId;

    @Value("${teller.enrollments-path:/data/teller-enrollments.json}")
    private String enrollmentsPath;

    @Value("${teller.accounts-cache-path:/data/teller-accounts-cache.json}")
    private String accountsCachePath;

    @PostConstruct
    void loadEnrollments() {
        Path path = Path.of(enrollmentsPath);
        if (!Files.exists(path)) return;
        // Acquire a shared lock on the file so we don't read mid-write
        try (RandomAccessFile raf = new RandomAccessFile(path.toFile(), "r");
             FileChannel channel = raf.getChannel();
             FileLock lock = channel.lock(0L, Long.MAX_VALUE, true)) {
            Map<String, String> saved = mapper.readValue(path.toFile(), mapper.getTypeFactory()
                    .constructMapType(HashMap.class, String.class, String.class));
            enrollments.clear();
            enrollments.putAll(saved);
            log.info("Loaded {} Teller enrollments from {}", enrollments.size(), enrollmentsPath);
        } catch (Exception e) {
            log.warn("Failed to load Teller enrollments from {}: {}", enrollmentsPath, e.getMessage());
        }
    }

    @GetMapping("/config")
    public Map<String, String> config() {
        return Map.of("appId", appId);
    }

    @PostMapping("/enroll")
    public Map<String, Object> enroll(@RequestBody EnrollRequest req) {
        if (req.getAccessToken() == null || req.getAccessToken().isBlank()) {
            return Map.of("status", "error", "message", "accessToken is required");
        }
        enrollments.put(req.getAccessToken(), req.getInstitution() != null ? req.getInstitution() : "Unknown");
        persistEnrollments();
        log.info("Enrolled institution: {} (total: {})", req.getInstitution(), enrollments.size());
        return Map.of("status", "ok", "institution", req.getInstitution(), "enrolled", enrollments.size());
    }

    @GetMapping("/accounts")
    public List<Map<String, Object>> accounts() {
        List<Map<String, Object>> all = new ArrayList<>();
        for (var entry : enrollments.entrySet()) {
            try {
                List<JsonNode> accs = tellerClient.get().uri("/accounts")
                        .headers(h -> h.setBasicAuth(entry.getKey(), ""))
                        .retrieve()
                        .bodyToFlux(JsonNode.class)
                        .collectList().block();

                if (accs == null) continue;
                for (JsonNode a : accs) {
                    String accId = a.path("id").asText();
                    BigDecimal balance = fetchBalance(entry.getKey(), accId);
                    all.add(Map.of(
                            "id",        accId,
                            "name",      a.path("name").asText(entry.getValue()),
                            "type",      a.path("type").asText("depository"),
                            "subtype",   a.path("subtype").asText("checking"),
                            "balance",   balance,
                            "available", balance,
                            "currency",  a.path("currency").asText("USD"),
                            "institution", a.path("institution").path("name").asText(entry.getValue())
                    ));
                }
            } catch (Exception e) {
                log.error("Failed to fetch accounts for enrollment: {}", e.getMessage());
            }
        }
        if (!all.isEmpty()) {
            persistAccountsCache(all);
            return all;
        }
        List<Map<String, Object>> cached = loadAccountsCache();
        if (!cached.isEmpty()) {
            log.warn("Teller accounts unavailable; returning {} cached accounts", cached.size());
        }
        return cached;
    }

    @GetMapping("/transactions")
    public List<Map<String, Object>> transactions(@RequestParam(defaultValue = "30") int days) {
        List<Map<String, Object>> all = new ArrayList<>();
        LocalDate cutoff = LocalDate.now().minusDays(Math.max(0, days));
        for (var entry : enrollments.entrySet()) {
            try {
                List<JsonNode> accs = tellerClient.get().uri("/accounts")
                        .headers(h -> h.setBasicAuth(entry.getKey(), ""))
                        .retrieve()
                        .bodyToFlux(JsonNode.class)
                        .collectList().block();

                if (accs == null) continue;
                for (JsonNode a : accs) {
                    String accId = a.path("id").asText();
                    try {
                        List<JsonNode> txs = tellerClient.get()
                                .uri("/accounts/{id}/transactions", accId)
                                .headers(h -> h.setBasicAuth(entry.getKey(), ""))
                                .retrieve()
                                .bodyToFlux(JsonNode.class)
                                .collectList().block();

                        if (txs == null) continue;
                        for (JsonNode t : txs) {
                            String postedDate = t.path("date").asText();
                            try {
                                if (LocalDate.parse(postedDate).isBefore(cutoff)) continue;
                            } catch (Exception ignored) {
                                continue;
                            }

                            String amtStr = t.path("amount").asText("0");
                            BigDecimal amt;
                            try { amt = new BigDecimal(amtStr); } // Teller: negative = debit, positive = credit — use as-is
                            catch (Exception ex) { amt = BigDecimal.ZERO; }

                            String merchant = t.path("details").path("counterparty").path("name").asText(
                                    t.path("description").asText("Unknown"));
                            String category = normalizeCategory(merchant,
                                    t.path("details").path("category").asText("other"),
                                    t.path("type").asText(""));

                            all.add(Map.of(
                                    "id",       t.path("id").asText(),
                                    "merchant", merchant,
                                    "category", capitalize(category.replace("_", " ")),
                                    "amount",   amt,
                                    "date",     postedDate,
                                    "currency", "USD",
                                    "pending",  "pending".equals(t.path("status").asText())
                            ));
                        }
                    } catch (Exception e) {
                        log.debug("Failed to fetch transactions for account {}: {}", accId, e.getMessage());
                    }
                }
            } catch (Exception e) {
                log.error("Failed to fetch transactions for enrollment: {}", e.getMessage());
            }
        }
        all.sort(Comparator.comparing(m -> String.valueOf(m.get("date")), Comparator.reverseOrder()));
        return all;
    }

    @PostMapping("/sync")
    public Map<String, Object> sync() {
        try {
            publishToKafka();
            return Map.of("status", "ok", "enrollments", enrollments.size());
        } catch (Exception e) {
            return Map.of("status", "error", "message", e.getMessage());
        }
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        return Map.of("enrolled", enrollments.size(), "institutions", new ArrayList<>(enrollments.values()));
    }

    @Scheduled(fixedRate = 600_000, initialDelay = 600_000)
    public void scheduledSync() {
        if (enrollments.isEmpty()) return;
        log.info("Scheduled Teller sync for {} enrollments", enrollments.size());
        try { publishToKafka(); } catch (Exception e) { log.error("Sync failed", e); }
    }

    private BigDecimal fetchBalance(String accessToken, String accountId) {
        try {
            JsonNode b = tellerClient.get()
                    .uri("/accounts/{id}/balances", accountId)
                    .headers(h -> h.setBasicAuth(accessToken, ""))
                    .retrieve()
                    .bodyToMono(JsonNode.class).block();
            if (b == null) return BigDecimal.ZERO;
            String ledger = b.path("ledger").asText(b.path("available").asText("0"));
            return new BigDecimal(ledger);
        } catch (Exception e) {
            return BigDecimal.ZERO;
        }
    }

    /**
     * Atomically persists the enrollments map. Uses an exclusive file lock on a sibling
     * .lock file so that concurrent writers serialize, plus a tmp-file + ATOMIC_MOVE to
     * avoid leaving a truncated JSON on disk if the JVM dies mid-write.
     */
    private synchronized void persistEnrollments() {
        try {
            Path path = Path.of(enrollmentsPath);
            if (path.getParent() != null) {
                Files.createDirectories(path.getParent());
            }
            Path lockFile = path.resolveSibling(path.getFileName().toString() + ".lock");
            Path tmpFile = path.resolveSibling(path.getFileName().toString() + ".tmp");
            try (RandomAccessFile raf = new RandomAccessFile(lockFile.toFile(), "rw");
                 FileChannel channel = raf.getChannel();
                 FileLock lock = channel.lock()) {
                mapper.writerWithDefaultPrettyPrinter().writeValue(tmpFile.toFile(), enrollments);
                try {
                    Files.move(tmpFile, path,
                            StandardCopyOption.REPLACE_EXISTING,
                            StandardCopyOption.ATOMIC_MOVE);
                } catch (java.nio.file.AtomicMoveNotSupportedException atomicEx) {
                    // Some filesystems (e.g. cross-mount) can't do atomic moves; fall back.
                    Files.move(tmpFile, path, StandardCopyOption.REPLACE_EXISTING);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to persist Teller enrollments to {}: {}", enrollmentsPath, e.getMessage());
        }
    }

    private void publishToKafka() throws Exception {
        for (var acc : accounts()) {
            kafka.send("teller.balances", (String) acc.get("id"), mapper.writeValueAsString(acc));
        }
    }

    private List<Map<String, Object>> loadAccountsCache() {
        Path path = Path.of(accountsCachePath);
        if (!Files.exists(path)) return List.of();
        try {
            return mapper.readValue(path.toFile(), mapper.getTypeFactory()
                    .constructCollectionType(ArrayList.class, Map.class));
        } catch (Exception e) {
            log.warn("Failed to load Teller accounts cache from {}: {}", accountsCachePath, e.getMessage());
            return List.of();
        }
    }

    private synchronized void persistAccountsCache(List<Map<String, Object>> accounts) {
        try {
            Path path = Path.of(accountsCachePath);
            if (path.getParent() != null) Files.createDirectories(path.getParent());
            mapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), accounts);
        } catch (Exception e) {
            log.warn("Failed to persist Teller accounts cache to {}: {}", accountsCachePath, e.getMessage());
        }
    }

    private String normalizeCategory(String merchant, String tellerCategory, String type) {
        String m = merchant.toLowerCase();
        // Merchant-based overrides take precedence
        if (m.contains("interest payment")) return "Income";
        if (m.contains("online transfer") || m.contains("internal transfer") || m.contains("zelle payment")
                || m.contains("venmo") || m.contains("paypal") || m.contains("cash app") || m.contains("cashapp")) {
            return "Transfer";
        }
        if (m.contains("uber eats") || m.contains("doordash") || m.contains("grubhub")
                || m.contains("postmates") || m.contains("seamless") || m.contains("caviar")) {
            return "Food & Dining";
        }
        if (m.contains("uber")) return "Food & Dining"; // user: uber = food
        if (m.contains("lyft"))  return "Transportation";
        // Map Teller categories to display names
        return switch (tellerCategory.toLowerCase()) {
            case "food_and_drink", "dining_out", "restaurants" -> "Food & Dining";
            case "groceries"          -> "Groceries";
            case "transportation"     -> "Transportation";
            case "gas_stations", "gas" -> "Gas";
            case "shopping", "retail" -> "Shopping";
            case "entertainment"      -> "Entertainment";
            case "health"             -> "Health";
            case "utilities"          -> "Utilities";
            case "rent", "housing"    -> "Housing";
            case "transfer", "transfers", "account_transfer" -> "Transfer";
            case "income", "payroll"  -> "Income";
            default -> capitalize(tellerCategory.replace("_", " "));
        };
    }

    private String capitalize(String s) {
        if (s == null || s.isEmpty()) return s;
        return Character.toUpperCase(s.charAt(0)) + s.substring(1).toLowerCase();
    }
}

@RestController
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
class BankingHealthController {

    private final BankingController bankingController;

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
                "status", "healthy",
                "service", "teller-banking-svc",
                "enrolled", bankingController.status().get("enrolled")
        );
    }
}
