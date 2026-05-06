package com.alphatrade.alerts;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.*;
import lombok.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Alerts Service — single-file Spring Boot module
 *
 * Subscribes to:
 *   - market.ticks         (price-threshold alerts)
 *   - banking.transactions (budget-threshold alerts)
 *   - net.worth.snapshots  (net-worth-change alerts)
 *
 * Sends email via Resend API (3000/mo free tier).
 *
 * Endpoints:
 *   GET    /alerts/rules         — list rules
 *   POST   /alerts/rules         — create rule
 *   DELETE /alerts/rules/{id}    — remove rule
 *   GET    /alerts/history       — recent triggered alerts
 *
 * Set RESEND_API_KEY and ALERT_TO_EMAIL in environment.
 */
@SpringBootApplication
public class AlertsApplication {
    public static void main(String[] args) {
        SpringApplication.run(AlertsApplication.class, args);
    }

    @Bean
    public WebClient webClient() { return WebClient.builder().build(); }
}

@Data
@Entity
@Table(name = "alert_rules")
@NoArgsConstructor
@AllArgsConstructor
@Builder
class AlertRule {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;
    private String type;          // "price_above", "price_below", "budget_exceed", "net_worth_change"
    private String target;        // symbol, category, or "total"
    private BigDecimal threshold;
    private boolean enabled = true;
    private Instant createdAt;
}

@Data
@Entity
@Table(name = "alert_history")
@NoArgsConstructor
@AllArgsConstructor
@Builder
class AlertEvent {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private Long ruleId;
    private String message;
    private BigDecimal currentValue;
    private boolean emailSent;
    private Instant triggeredAt;
}

interface AlertRuleRepository extends JpaRepository<AlertRule, Long> {
    List<AlertRule> findByEnabledTrue();
}

interface AlertEventRepository extends JpaRepository<AlertEvent, Long> {
    List<AlertEvent> findTop50ByOrderByTriggeredAtDesc();
}

@Slf4j
@RestController
@RequestMapping("/alerts")
@CrossOrigin(origins = "*")
class AlertsController {

    private final AlertRuleRepository ruleRepo;
    private final AlertEventRepository eventRepo;
    private final WebClient webClient;
    private final ObjectMapper mapper;

    @Value("${resend.api-key:}")
    private String resendKey;
    @Value("${resend.from:alerts@alphawealth.app}")
    private String fromAddress;
    @Value("${alert.to:}")
    private String toAddress;

    AlertsController(AlertRuleRepository ruleRepo, AlertEventRepository eventRepo,
                     WebClient webClient, ObjectMapper mapper) {
        this.ruleRepo = ruleRepo;
        this.eventRepo = eventRepo;
        this.webClient = webClient;
        this.mapper = mapper;
    }

    @GetMapping("/rules")
    public List<AlertRule> listRules() { return ruleRepo.findAll(); }

    @PostMapping("/rules")
    public AlertRule createRule(@RequestBody AlertRule rule) {
        if (rule.getCreatedAt() == null) rule.setCreatedAt(Instant.now());
        return ruleRepo.save(rule);
    }

    @DeleteMapping("/rules/{id}")
    public void deleteRule(@PathVariable Long id) { ruleRepo.deleteById(id); }

    @GetMapping("/history")
    public List<AlertEvent> history() { return eventRepo.findTop50ByOrderByTriggeredAtDesc(); }

    // ─── Kafka listeners ───────────────────────────────────

    @KafkaListener(topics = "market.ticks", groupId = "alerts-svc")
    public void onMarketTick(String json) {
        try {
            JsonNode tick = mapper.readTree(json);
            String symbol = tick.path("symbol").asText();
            BigDecimal price = new BigDecimal(tick.path("price").asText("0"));

            for (AlertRule rule : ruleRepo.findByEnabledTrue()) {
                if (!symbol.equals(rule.getTarget())) continue;

                boolean triggered = switch (rule.getType()) {
                    case "price_above" -> price.compareTo(rule.getThreshold()) > 0;
                    case "price_below" -> price.compareTo(rule.getThreshold()) < 0;
                    default -> false;
                };

                if (triggered) {
                    String msg = String.format("%s is at $%s (%s threshold $%s)",
                            symbol, price, rule.getType().replace("_", " "), rule.getThreshold());
                    triggerAlert(rule, msg, price);
                }
            }
        } catch (Exception e) {
            log.error("Failed to process market tick", e);
        }
    }

    @KafkaListener(topics = "banking.transactions", groupId = "alerts-svc")
    public void onTransaction(String json) {
        try {
            JsonNode tx = mapper.readTree(json);
            String category = tx.path("category").asText();
            BigDecimal amount = new BigDecimal(tx.path("amount").asText("0")).abs();

            for (AlertRule rule : ruleRepo.findByEnabledTrue()) {
                if (!"budget_exceed".equals(rule.getType())) continue;
                if (!category.equals(rule.getTarget())) continue;

                if (amount.compareTo(rule.getThreshold()) > 0) {
                    String msg = String.format("Spent $%s on %s (over $%s threshold)",
                            amount, category, rule.getThreshold());
                    triggerAlert(rule, msg, amount);
                }
            }
        } catch (Exception e) {
            log.error("Failed to process transaction", e);
        }
    }

    @KafkaListener(topics = "net.worth.snapshots", groupId = "alerts-svc")
    public void onNetWorthSnapshot(String json) {
        try {
            JsonNode snap = mapper.readTree(json);
            BigDecimal netWorth = new BigDecimal(snap.path("netWorth").asText("0"));

            for (AlertRule rule : ruleRepo.findByEnabledTrue()) {
                if (!"net_worth_change".equals(rule.getType())) continue;

                if (netWorth.compareTo(rule.getThreshold()) > 0 ||
                    netWorth.compareTo(rule.getThreshold()) < 0) {
                    String msg = String.format("Net worth crossed $%s threshold (current: $%s)",
                            rule.getThreshold(), netWorth);
                    triggerAlert(rule, msg, netWorth);
                }
            }
        } catch (Exception e) {
            log.error("Failed to process net worth snapshot", e);
        }
    }

    private void triggerAlert(AlertRule rule, String message, BigDecimal value) {
        boolean emailSent = sendEmail(rule.getName(), message);
        AlertEvent event = AlertEvent.builder()
                .ruleId(rule.getId())
                .message(message)
                .currentValue(value)
                .emailSent(emailSent)
                .triggeredAt(Instant.now())
                .build();
        eventRepo.save(event);
        log.info("Alert triggered: {} (email_sent={})", message, emailSent);
    }

    private boolean sendEmail(String subject, String body) {
        if (resendKey == null || resendKey.isBlank() || toAddress == null || toAddress.isBlank()) {
            log.debug("Email skipped — RESEND_API_KEY or ALERT_TO_EMAIL not configured");
            return false;
        }
        try {
            Map<String, Object> payload = Map.of(
                    "from", fromAddress,
                    "to", toAddress,
                    "subject", "[AlphaWealth] " + subject,
                    "html", "<p>" + body + "</p>"
            );
            webClient.post()
                    .uri("https://api.resend.com/emails")
                    .header("Authorization", "Bearer " + resendKey)
                    .header("Content-Type", "application/json")
                    .bodyValue(mapper.writeValueAsString(payload))
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(10))
                    .block();
            return true;
        } catch (Exception e) {
            log.error("Email send failed", e);
            return false;
        }
    }
}
