package com.alphatrade.netwealth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.*;
import lombok.*;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.kafka.annotation.KafkaListener;
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
 *   - plaid.balances                   (cash account balances)
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

interface NetWorthSnapshotRepository extends JpaRepository<NetWorthSnapshot, Long> {
    List<NetWorthSnapshot> findAllByOrderByTimestampDesc();
}

interface ManualAssetRepository extends JpaRepository<ManualAsset, Long> {}
interface ManualLiabilityRepository extends JpaRepository<ManualLiability, Long> {}

@Slf4j
@Service
@RequiredArgsConstructor
class NetWorthAggregator {

    private final NetWorthSnapshotRepository snapshotRepo;
    private final ManualAssetRepository manualAssetRepo;
    private final ManualLiabilityRepository manualLiabRepo;
    private final ObjectMapper mapper;

    // In-memory caches updated by Kafka listeners
    private final Map<String, BigDecimal> ibkrPositionValues = new ConcurrentHashMap<>();
    private BigDecimal ibkrCash = BigDecimal.ZERO;
    private final Map<String, BigDecimal> plaidBalances = new ConcurrentHashMap<>();

    @KafkaListener(topics = "ibkr.positions", groupId = "net-worth-svc")
    public void onIbkrPosition(String json) {
        try {
            JsonNode node = mapper.readTree(json);
            String symbol = node.get("symbol").asText();
            BigDecimal marketValue = node.has("marketValue") && !node.get("marketValue").isNull()
                    ? new BigDecimal(node.get("marketValue").asText())
                    : new BigDecimal(node.get("position").asText())
                            .multiply(node.has("avgCost") ? new BigDecimal(node.get("avgCost").asText()) : BigDecimal.ONE);
            ibkrPositionValues.put(symbol, marketValue);
        } catch (Exception e) {
            log.error("Failed to parse IBKR position", e);
        }
    }

    @KafkaListener(topics = "ibkr.account", groupId = "net-worth-svc")
    public void onIbkrAccount(String json) {
        try {
            JsonNode node = mapper.readTree(json);
            if (node.has("totalCash") && !node.get("totalCash").isNull()) {
                ibkrCash = new BigDecimal(node.get("totalCash").asText());
            }
        } catch (Exception e) {
            log.error("Failed to parse IBKR account", e);
        }
    }

    @KafkaListener(topics = {"teller.balances", "plaid.balances"}, groupId = "net-worth-svc")
    public void onBankBalance(String json) {
        try {
            JsonNode node = mapper.readTree(json);
            String id = node.get("id").asText();
            BigDecimal balance = new BigDecimal(node.get("balance").toString());
            plaidBalances.put(id, balance);
        } catch (Exception e) {
            log.error("Failed to parse bank balance", e);
        }
    }

    public NetWorthSnapshot computeCurrent() {
        BigDecimal investments = ibkrPositionValues.values().stream()
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal cash = ibkrCash.add(plaidBalances.values().stream()
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
        NetWorthSnapshot snapshot = computeCurrent();
        snapshotRepo.save(snapshot);
        log.info("Saved net worth snapshot: ${}", snapshot.getNetWorth().setScale(2, RoundingMode.HALF_UP));
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
        if (asset.getAsOfDate() == null) asset.setAsOfDate(LocalDate.now());
        return manualAssetRepo.save(asset);
    }

    @PostMapping("/manual-liability")
    public ManualLiability addManualLiability(@RequestBody ManualLiability liab) {
        if (liab.getAsOfDate() == null) liab.setAsOfDate(LocalDate.now());
        return manualLiabRepo.save(liab);
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
