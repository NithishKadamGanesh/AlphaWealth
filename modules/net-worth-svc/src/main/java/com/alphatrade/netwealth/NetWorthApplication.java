package com.alphatrade.netwealth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.*;
import lombok.*;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Net Worth Aggregator Service — single-file Spring Boot module
 *
 * Subscribes to:
 *   - ibkr.positions, ibkr.account     (IBKR investment values)
 *   - teller.balances                  (cash account balances)
 *
 * Publishes:
 *   - net.worth.snapshots              (every 1 hour)
 *
 * Persists:
 *   - net_worth_snapshots (TimescaleDB hypertable)
 *   - manual_assets, manual_liabilities (user-entered)
 *
 * REST:
 *   GET  /networth/current              — current snapshot
 *   GET  /networth/history?days=730     — historical snapshots
 *   GET  /networth/breakdown            — assets + liabilities by category
 *   POST /networth/manual-asset         — add/update manual asset
 *   POST /networth/manual-liability     — add/update manual liability
 */
@SpringBootApplication
@EnableScheduling
public class NetWorthApplication {
    public static void main(String[] args) {
        SpringApplication.run(NetWorthApplication.class, args);
    }
}

@Data
@Entity
@Table(name = "net_worth_snapshots")
@NoArgsConstructor
@AllArgsConstructor
@Builder
class NetWorthSnapshot {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private Instant timestamp;
    private BigDecimal totalAssets;
    private BigDecimal totalLiabilities;
    private BigDecimal netWorth;
    private BigDecimal cash;
    private BigDecimal investments;
    private BigDecimal property;
    private BigDecimal retirement;
    private BigDecimal crypto;
    private BigDecimal otherAssets;
}

@Data
@Entity
@Table(name = "manual_assets")
@NoArgsConstructor
@AllArgsConstructor
class ManualAsset {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;
    private String type;        // "property", "retirement", "crypto", "other"
    private BigDecimal value;
    private LocalDate asOfDate;
}

@Data
@Entity
@Table(name = "manual_liabilities")
@NoArgsConstructor
@AllArgsConstructor
class ManualLiability {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;
    private String type;        // "mortgage", "student-loan", "auto", "credit-card", "other"
    private BigDecimal value;
    private BigDecimal interestRate;
    private LocalDate asOfDate;
}

@Data
@Entity
@Table(name = "budget_categories")
@NoArgsConstructor
@AllArgsConstructor
class BudgetCategory {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(unique = true, nullable = false)
    private String name;
    @Column(name = "monthly_limit")
    private BigDecimal monthlyLimit;
    private String color;
    @Column(name = "created_at", insertable = false, updatable = false)
    private Instant createdAt;
}

interface NetWorthSnapshotRepository extends JpaRepository<NetWorthSnapshot, Long> {
    List<NetWorthSnapshot> findAllByOrderByTimestampDesc();
}

interface ManualAssetRepository extends JpaRepository<ManualAsset, Long> {}
interface ManualLiabilityRepository extends JpaRepository<ManualLiability, Long> {}
interface BudgetCategoryRepository extends JpaRepository<BudgetCategory, Long> {
    Optional<BudgetCategory> findByName(String name);
    List<BudgetCategory> findAllByOrderByNameAsc();
}

@Slf4j
@Service
@RequiredArgsConstructor
class NetWorthAggregator {

    private final NetWorthSnapshotRepository snapshotRepo;
    private final ManualAssetRepository manualAssetRepo;
    private final ManualLiabilityRepository manualLiabRepo;
    private final ObjectMapper mapper;
    private final KafkaTemplate<String, String> kafka;

    // In-memory caches updated by Kafka listeners
    private final Map<String, BigDecimal> ibkrPositionValues = new ConcurrentHashMap<>();
    private BigDecimal ibkrCash = BigDecimal.ZERO;
    private final Map<String, BigDecimal> bankBalances = new ConcurrentHashMap<>();

    @KafkaListener(topics = "ibkr.positions", groupId = "net-worth-svc")
    public void onIbkrPosition(String json) {
        try {
            JsonNode node = mapper.readTree(json);
            // Schema validation: symbol is mandatory
            if (!node.hasNonNull("symbol")) {
                log.warn("Discarding IBKR position with no 'symbol' field: {}", json);
                return;
            }
            String symbol = node.get("symbol").asText();

            BigDecimal marketValue;
            if (node.hasNonNull("marketValue")) {
                marketValue = decimalOrZero(node.get("marketValue").asText(), "marketValue", symbol);
            } else if (node.hasNonNull("position") && node.hasNonNull("avgCost")) {
                log.warn("IBKR position {} missing 'marketValue' — falling back to position*avgCost (this is an approximation)", symbol);
                BigDecimal qty = decimalOrZero(node.get("position").asText(), "position", symbol);
                BigDecimal cost = decimalOrZero(node.get("avgCost").asText(), "avgCost", symbol);
                marketValue = qty.multiply(cost);
            } else {
                log.warn("IBKR position {} has neither marketValue nor (position,avgCost) — skipping", symbol);
                return;
            }
            ibkrPositionValues.put(symbol, marketValue);
        } catch (Exception e) {
            log.error("Failed to parse IBKR position: {}", json, e);
        }
    }

    @KafkaListener(topics = "ibkr.account", groupId = "net-worth-svc")
    public void onIbkrAccount(String json) {
        try {
            JsonNode node = mapper.readTree(json);
            if (node.hasNonNull("totalCash")) {
                ibkrCash = decimalOrZero(node.get("totalCash").asText(), "totalCash", "ibkr-account");
            } else {
                log.debug("IBKR account message has no 'totalCash' — leaving cash unchanged");
            }
        } catch (Exception e) {
            log.error("Failed to parse IBKR account: {}", json, e);
        }
    }

    @KafkaListener(topics = {"teller.balances"}, groupId = "net-worth-svc")
    public void onBankBalance(String json) {
        try {
            JsonNode node = mapper.readTree(json);
            if (!node.hasNonNull("id")) {
                log.warn("Discarding bank balance with no 'id' field: {}", json);
                return;
            }
            if (!node.hasNonNull("balance")) {
                log.warn("Bank balance for account {} has no 'balance' field — skipping", node.get("id").asText());
                return;
            }
            String id = node.get("id").asText();
            BigDecimal balance = decimalOrZero(node.get("balance").toString(), "balance", id);
            bankBalances.put(id, balance);
        } catch (Exception e) {
            log.error("Failed to parse bank balance: {}", json, e);
        }
    }

    /** Parse a string into BigDecimal, logging a warning + returning zero on failure. */
    private BigDecimal decimalOrZero(String raw, String field, String context) {
        try {
            // Strip optional JSON quoting that asText() might leave us
            String trimmed = raw == null ? "0" : raw.trim().replace("\"", "");
            return new BigDecimal(trimmed);
        } catch (Exception e) {
            log.warn("Invalid numeric field '{}' for {}: '{}' — using 0", field, context, raw);
            return BigDecimal.ZERO;
        }
    }

    public NetWorthSnapshot computeCurrent() {
        BigDecimal investments = ibkrPositionValues.values().stream()
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal cash = ibkrCash.add(bankBalances.values().stream()
                .reduce(BigDecimal.ZERO, BigDecimal::add));

        Map<String, BigDecimal> assetByType = new HashMap<>();
        for (ManualAsset a : manualAssetRepo.findAll()) {
            assetByType.merge(a.getType(), a.getValue(), BigDecimal::add);
        }
        BigDecimal property   = assetByType.getOrDefault("property", BigDecimal.ZERO);
        BigDecimal retirement = assetByType.getOrDefault("retirement", BigDecimal.ZERO);
        BigDecimal crypto     = assetByType.getOrDefault("crypto", BigDecimal.ZERO);
        BigDecimal other      = assetByType.getOrDefault("other", BigDecimal.ZERO);

        BigDecimal totalLiabilities = manualLiabRepo.findAll().stream()
                .map(ManualLiability::getValue)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal totalAssets = investments.add(cash).add(property).add(retirement).add(crypto).add(other);
        BigDecimal netWorth = totalAssets.subtract(totalLiabilities);

        return NetWorthSnapshot.builder()
                .timestamp(Instant.now())
                .totalAssets(totalAssets)
                .totalLiabilities(totalLiabilities)
                .netWorth(netWorth)
                .cash(cash)
                .investments(investments)
                .property(property)
                .retirement(retirement)
                .crypto(crypto)
                .otherAssets(other)
                .build();
    }

    @Scheduled(fixedRate = 3_600_000) // every hour
    public void persistSnapshot() {
        snapshotNow();
    }

    /** Persist a snapshot immediately and return it. Used by /snapshot-now endpoint
     *  and by the hourly scheduler. */
    public NetWorthSnapshot snapshotNow() {
        NetWorthSnapshot snapshot = computeCurrent();
        snapshotRepo.save(snapshot);
        publishSnapshot(snapshot);
        log.info("Saved net worth snapshot: ${}", snapshot.getNetWorth().setScale(2, RoundingMode.HALF_UP));
        return snapshot;
    }

    private void publishSnapshot(NetWorthSnapshot snapshot) {
        try {
            kafka.send("net.worth.snapshots", "total", mapper.writeValueAsString(Map.of(
                    "timestamp", snapshot.getTimestamp(),
                    "totalAssets", snapshot.getTotalAssets(),
                    "totalLiabilities", snapshot.getTotalLiabilities(),
                    "netWorth", snapshot.getNetWorth(),
                    "cash", snapshot.getCash(),
                    "investments", snapshot.getInvestments(),
                    "source", "net-worth-svc"
            )));
        } catch (Exception e) {
            log.warn("Failed to publish net worth snapshot: {}", e.getMessage());
        }
    }
}

@RestController
@RequestMapping("/networth")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
class NetWorthController {

    private final NetWorthAggregator aggregator;
    private final NetWorthSnapshotRepository snapshotRepo;
    private final ManualAssetRepository manualAssetRepo;
    private final ManualLiabilityRepository manualLiabRepo;

    @GetMapping("/current")
    public NetWorthSnapshot current() {
        return aggregator.computeCurrent();
    }

    @GetMapping("/history")
    public List<NetWorthSnapshot> history(@RequestParam(defaultValue = "730") int days) {
        return snapshotRepo.findAllByOrderByTimestampDesc()
                .stream()
                .limit(days * 24L) // hourly snapshots
                .toList();
    }

    @GetMapping("/breakdown")
    public Map<String, Object> breakdown() {
        NetWorthSnapshot current = aggregator.computeCurrent();
        return Map.of(
                "snapshot", current,
                "manualAssets", manualAssetRepo.findAll(),
                "manualLiabilities", manualLiabRepo.findAll()
        );
    }

    @PostMapping("/manual-asset")
    public ManualAsset addManualAsset(@RequestBody ManualAsset asset) {
        if (asset.getName() == null || asset.getName().isBlank()) {
            throw new IllegalArgumentException("Manual asset name is required");
        }
        if (asset.getValue() == null) {
            throw new IllegalArgumentException("Manual asset value is required");
        }
        if (asset.getValue().signum() < 0) {
            throw new IllegalArgumentException("Manual asset value must be non-negative");
        }
        if (asset.getAsOfDate() == null) asset.setAsOfDate(LocalDate.now());
        return manualAssetRepo.save(asset);
    }

    @PostMapping("/manual-liability")
    public ManualLiability addManualLiability(@RequestBody ManualLiability liab) {
        if (liab.getName() == null || liab.getName().isBlank()) {
            throw new IllegalArgumentException("Manual liability name is required");
        }
        if (liab.getValue() == null) {
            throw new IllegalArgumentException("Manual liability value is required");
        }
        if (liab.getValue().signum() < 0) {
            throw new IllegalArgumentException("Manual liability value must be non-negative");
        }
        if (liab.getInterestRate() != null && liab.getInterestRate().signum() < 0) {
            throw new IllegalArgumentException("Interest rate must be non-negative");
        }
        if (liab.getAsOfDate() == null) liab.setAsOfDate(LocalDate.now());
        return manualLiabRepo.save(liab);
    }

    /** Force an immediate snapshot — useful before a server restart to avoid losing
     *  the last partial hour of history. */
    @PostMapping("/snapshot-now")
    public NetWorthSnapshot snapshotNow() {
        return aggregator.snapshotNow();
    }
}

/**
 * Budget category CRUD. The init.sql seeds a sensible default set on first
 * boot, but everything below this point lets the UI fully manage them.
 *
 * Endpoints:
 *   GET    /budgets                 — list all categories
 *   POST   /budgets                 — create or upsert (by unique name)
 *   PUT    /budgets/{id}            — update an existing category
 *   DELETE /budgets/{id}            — remove a category
 */
@RestController
@RequestMapping("/budgets")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
class BudgetCategoryController {

    private final BudgetCategoryRepository budgetRepo;

    @GetMapping
    public List<BudgetCategory> list() {
        return budgetRepo.findAllByOrderByNameAsc();
    }

    @PostMapping
    public BudgetCategory createOrUpsert(@RequestBody BudgetCategory body) {
        validate(body);
        // If a category with this name already exists, treat as upsert. The unique
        // constraint on `name` would otherwise reject the insert with a 500.
        Optional<BudgetCategory> existing = budgetRepo.findByName(body.getName());
        if (existing.isPresent()) {
            BudgetCategory cat = existing.get();
            if (body.getMonthlyLimit() != null) cat.setMonthlyLimit(body.getMonthlyLimit());
            if (body.getColor() != null) cat.setColor(body.getColor());
            return budgetRepo.save(cat);
        }
        body.setId(null);
        return budgetRepo.save(body);
    }

    @PutMapping("/{id}")
    public BudgetCategory update(@PathVariable Long id, @RequestBody BudgetCategory body) {
        BudgetCategory cat = budgetRepo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Budget category " + id + " not found"));
        if (body.getName() != null && !body.getName().isBlank()) cat.setName(body.getName().trim());
        if (body.getMonthlyLimit() != null) {
            if (body.getMonthlyLimit().signum() < 0) {
                throw new IllegalArgumentException("monthlyLimit must be non-negative");
            }
            cat.setMonthlyLimit(body.getMonthlyLimit());
        }
        if (body.getColor() != null) cat.setColor(body.getColor());
        return budgetRepo.save(cat);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        if (!budgetRepo.existsById(id)) {
            return Map.of("status", "not_found", "id", id);
        }
        budgetRepo.deleteById(id);
        return Map.of("status", "deleted", "id", id);
    }

    private void validate(BudgetCategory body) {
        if (body.getName() == null || body.getName().isBlank()) {
            throw new IllegalArgumentException("Budget category name is required");
        }
        body.setName(body.getName().trim());
        if (body.getMonthlyLimit() != null && body.getMonthlyLimit().signum() < 0) {
            throw new IllegalArgumentException("monthlyLimit must be non-negative");
        }
    }
}

@RestController
@CrossOrigin(origins = "*")
class NetWorthHealthController {

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
                "status", "healthy",
                "service", "net-worth-svc"
        );
    }
}
