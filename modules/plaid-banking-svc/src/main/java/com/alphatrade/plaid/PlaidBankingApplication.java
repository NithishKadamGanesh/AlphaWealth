package com.alphatrade.plaid;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.plaid.client.ApiClient;
import com.plaid.client.model.*;
import com.plaid.client.request.PlaidApi;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Plaid Banking Service — single-file Spring Boot module
 *
 * Wires Chase (and any Plaid-supported bank) into AlphaWealth.
 * Endpoints:
 *   POST /plaid/link/token         — Create link token for Plaid Link UI
 *   POST /plaid/link/exchange      — Exchange public_token for access_token
 *   GET  /plaid/accounts           — List connected accounts
 *   GET  /plaid/transactions       — Recent transactions
 *   GET  /plaid/balances           — Current balances
 *   POST /plaid/sync               — Force resync from Plaid
 *
 * Set PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV in environment.
 * For development: env=sandbox (test creds: user_good / pass_good)
 */
@Slf4j
@SpringBootApplication
@EnableScheduling
public class PlaidBankingApplication {

    public static void main(String[] args) {
        SpringApplication.run(PlaidBankingApplication.class, args);
    }

    @Bean
    public PlaidApi plaidApi(
            @Value("${plaid.client-id}") String clientId,
            @Value("${plaid.secret}") String secret,
            @Value("${plaid.env:sandbox}") String env) {

        HashMap<String, String> apiKeys = new HashMap<>();
        apiKeys.put("clientId", clientId);
        apiKeys.put("secret", secret);
        apiKeys.put("plaidVersion", "2020-09-14");

        ApiClient apiClient = new ApiClient(apiKeys);
        switch (env.toLowerCase()) {
            case "production"  -> apiClient.setPlaidAdapter(ApiClient.Production);
            case "development" -> apiClient.setPlaidAdapter(ApiClient.Development);
            default            -> apiClient.setPlaidAdapter(ApiClient.Sandbox);
        }

        log.info("Plaid client initialized: env={}", env);
        return apiClient.createService(PlaidApi.class);
    }
}

@Data
class LinkTokenRequest {
    private String userId = "alphawealth-user-1";
    private String clientName = "AlphaWealth";
}

@Data
class TokenExchangeRequest {
    private String publicToken;
    private String institution;
}

@Slf4j
@RestController
@RequestMapping("/plaid")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
class PlaidController {

    private final PlaidApi plaidApi;
    private final KafkaTemplate<String, String> kafka;
    private final ObjectMapper mapper;

    // In-memory token store (use DB in production)
    private final Map<String, String> accessTokens = new ConcurrentHashMap<>();

    @PostMapping("/link/token")
    public Map<String, String> createLinkToken(@RequestBody(required = false) LinkTokenRequest req) throws Exception {
        if (req == null) req = new LinkTokenRequest();

        LinkTokenCreateRequest request = new LinkTokenCreateRequest()
                .user(new LinkTokenCreateRequestUser().clientUserId(req.getUserId()))
                .clientName(req.getClientName())
                .products(List.of(Products.TRANSACTIONS, Products.AUTH))
                .countryCodes(List.of(CountryCode.US))
                .language("en");

        var response = plaidApi.linkTokenCreate(request).execute();
        if (!response.isSuccessful() || response.body() == null) {
            throw new RuntimeException("Plaid link token creation failed: " + response.errorBody());
        }

        return Map.of(
                "link_token", response.body().getLinkToken(),
                "expiration", response.body().getExpiration().toString()
        );
    }

    @PostMapping("/link/exchange")
    public Map<String, Object> exchangeToken(@RequestBody TokenExchangeRequest req) throws Exception {
        ItemPublicTokenExchangeRequest request = new ItemPublicTokenExchangeRequest()
                .publicToken(req.getPublicToken());

        var response = plaidApi.itemPublicTokenExchange(request).execute();
        if (!response.isSuccessful() || response.body() == null) {
            throw new RuntimeException("Token exchange failed");
        }

        String accessToken = response.body().getAccessToken();
        String itemId = response.body().getItemId();
        accessTokens.put(itemId, accessToken);

        log.info("Exchanged Plaid token for institution {}: itemId={}", req.getInstitution(), itemId);
        return Map.of("item_id", itemId, "status", "connected");
    }

    @GetMapping("/accounts")
    public List<Map<String, Object>> getAccounts() throws Exception {
        List<Map<String, Object>> all = new ArrayList<>();
        for (var entry : accessTokens.entrySet()) {
            AccountsGetRequest req = new AccountsGetRequest().accessToken(entry.getValue());
            var resp = plaidApi.accountsGet(req).execute();
            if (resp.isSuccessful() && resp.body() != null) {
                for (var acc : resp.body().getAccounts()) {
                    all.add(Map.of(
                            "id",        acc.getAccountId(),
                            "name",      acc.getName(),
                            "type",      acc.getType().toString(),
                            "subtype",   acc.getSubtype() != null ? acc.getSubtype().toString() : "",
                            "balance",   acc.getBalances().getCurrent() != null ? acc.getBalances().getCurrent() : 0,
                            "available", acc.getBalances().getAvailable() != null ? acc.getBalances().getAvailable() : 0,
                            "currency",  acc.getBalances().getIsoCurrencyCode()
                    ));
                }
            }
        }
        return all;
    }

    @GetMapping("/balances")
    public List<Map<String, Object>> getBalances() throws Exception {
        return getAccounts(); // same as accounts but emphasizing balance info
    }

    @GetMapping("/transactions")
    public List<Map<String, Object>> getTransactions(
            @RequestParam(defaultValue = "30") int days) throws Exception {
        LocalDate end = LocalDate.now();
        LocalDate start = end.minusDays(days);

        List<Map<String, Object>> all = new ArrayList<>();
        for (var entry : accessTokens.entrySet()) {
            TransactionsGetRequest req = new TransactionsGetRequest()
                    .accessToken(entry.getValue())
                    .startDate(start)
                    .endDate(end);
            var resp = plaidApi.transactionsGet(req).execute();
            if (resp.isSuccessful() && resp.body() != null) {
                for (var tx : resp.body().getTransactions()) {
                    all.add(Map.of(
                            "id",          tx.getTransactionId(),
                            "merchant",    tx.getMerchantName() != null ? tx.getMerchantName() : tx.getName(),
                            "amount",      BigDecimal.valueOf(tx.getAmount()).negate(),
                            "category",    tx.getCategory() != null ? tx.getCategory().get(0) : "Other",
                            "date",        tx.getDate().toString(),
                            "currency",    tx.getIsoCurrencyCode() != null ? tx.getIsoCurrencyCode() : "USD",
                            "pending",     tx.getPending()
                    ));
                }
            }
        }
        return all;
    }

    @PostMapping("/sync")
    public Map<String, Object> forceSync() {
        log.info("Force sync requested for {} institutions", accessTokens.size());
        try {
            publishBalancesToKafka();
            return Map.of("status", "ok", "institutions", accessTokens.size());
        } catch (Exception e) {
            return Map.of("status", "error", "message", e.getMessage());
        }
    }

    @Scheduled(fixedRate = 600_000) // every 10 minutes
    public void scheduledSync() {
        if (accessTokens.isEmpty()) return;
        log.info("Scheduled Plaid sync");
        try {
            publishBalancesToKafka();
        } catch (Exception e) {
            log.error("Scheduled sync failed", e);
        }
    }

    private void publishBalancesToKafka() throws Exception {
        for (var account : getAccounts()) {
            String json = mapper.writeValueAsString(account);
            kafka.send("plaid.balances", (String) account.get("id"), json);
        }
    }
}
