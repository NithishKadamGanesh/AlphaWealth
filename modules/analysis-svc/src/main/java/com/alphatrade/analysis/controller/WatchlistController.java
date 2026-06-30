package com.alphatrade.analysis.controller;

import com.alphatrade.analysis.entity.WatchlistItemEntity;
import com.alphatrade.analysis.repository.WatchlistRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Durable watchlist persisted in Postgres (replaces the browser-localStorage
 * list). The UI keeps a localStorage copy as an offline fallback, but this is
 * the source of truth and lets server-side scans/alerts use the same list.
 */
@RestController
@RequestMapping("/api/analysis/watchlist")
@CrossOrigin(origins = "*")
public class WatchlistController {

    private static final List<String> DEFAULTS =
        List.of("AAPL", "NVDA", "MSFT", "AMZN", "TSLA", "GOOGL", "META", "AMD", "SPY", "QQQ");

    private static final java.util.regex.Pattern SYMBOL = java.util.regex.Pattern.compile("[A-Z0-9.\\-]{1,16}");

    private final WatchlistRepository repo;

    public WatchlistController(WatchlistRepository repo) {
        this.repo = repo;
    }

    /** Current watchlist in order. Returns defaults (unpersisted) when empty. */
    @GetMapping
    public ResponseEntity<List<String>> get() {
        List<String> symbols = repo.findAllByOrderBySortOrderAsc()
            .stream().map(WatchlistItemEntity::getSymbol).collect(Collectors.toList());
        return ResponseEntity.ok(symbols.isEmpty() ? new ArrayList<>(DEFAULTS) : symbols);
    }

    /** Replace the whole watchlist. Body: {"symbols":["AAPL","NVDA",...]} */
    @PutMapping
    @Transactional
    public ResponseEntity<List<String>> put(@RequestBody Map<String, Object> body) {
        List<String> clean = new ArrayList<>();
        Object raw = body == null ? null : body.get("symbols");
        if (raw instanceof List<?> list) {
            for (Object o : list) {
                if (o == null) continue;
                String s = o.toString().trim().toUpperCase();
                if (SYMBOL.matcher(s).matches() && !clean.contains(s)) clean.add(s);
            }
        }
        replaceAll(clean);
        return ResponseEntity.ok(clean);
    }

    /** Add one symbol to the end if not already present. */
    @PostMapping("/{symbol}")
    @Transactional
    public ResponseEntity<List<String>> add(@PathVariable String symbol) {
        String s = symbol == null ? "" : symbol.trim().toUpperCase();
        if (SYMBOL.matcher(s).matches() && !repo.existsBySymbol(s)) {
            repo.save(new WatchlistItemEntity(s, (int) repo.count()));
        }
        return get();
    }

    /** Remove one symbol. */
    @DeleteMapping("/{symbol}")
    @Transactional
    public ResponseEntity<List<String>> remove(@PathVariable String symbol) {
        if (symbol != null) repo.deleteBySymbol(symbol.trim().toUpperCase());
        return get();
    }

    private void replaceAll(List<String> symbols) {
        repo.deleteAllInBatch();
        List<WatchlistItemEntity> items = new ArrayList<>();
        for (int i = 0; i < symbols.size(); i++) {
            items.add(new WatchlistItemEntity(symbols.get(i), i));
        }
        repo.saveAll(items);
    }
}
