package com.alphatrade.marketdata.controller;

import com.alphatrade.marketdata.entity.OhlcvEntity;
import com.alphatrade.marketdata.service.MarketDataService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.*;

@RestController
@RequestMapping("/api/marketdata")
@CrossOrigin(origins = "*")
public class MarketDataController {

    private final MarketDataService svc;
    public MarketDataController(MarketDataService svc) { this.svc = svc; }

    @PostMapping("/ingest/{symbol}")
    public ResponseEntity<Map<String, Object>> ingest(@PathVariable String symbol, @RequestParam(defaultValue = "full") String size) {
        String sym = symbol.toUpperCase();
        int count = "full".equals(size) ? svc.ingestDailyFull(sym) : svc.ingestDailyCompact(sym);
        return ResponseEntity.ok(Map.of("symbol", sym, "inserted", count, "status", "OK"));
    }

    /** Ingest crypto data from Binance (no API key needed) */
    @PostMapping("/ingest/{symbol}/crypto")
    public ResponseEntity<Map<String, Object>> ingestCrypto(@PathVariable String symbol) {
        int count = svc.ingestCrypto(symbol.toUpperCase());
        return ResponseEntity.ok(Map.of("symbol", symbol.toUpperCase(), "inserted", count, "source", "BINANCE"));
    }

    @PostMapping("/ingest/{symbol}/weekly")
    public ResponseEntity<Map<String, Object>> ingestWeekly(@PathVariable String symbol) {
        int count = svc.ingestWeekly(symbol.toUpperCase());
        return ResponseEntity.ok(Map.of("symbol", symbol.toUpperCase(), "inserted", count, "timeframe", "WEEKLY"));
    }

    @GetMapping("/candles/{symbol}")
    public ResponseEntity<List<Map<String, Object>>> getCandles(@PathVariable String symbol,
            @RequestParam(required = false) String from, @RequestParam(required = false) String to) {
        String sym = symbol.toUpperCase();
        List<OhlcvEntity> data;
        if (from != null && to != null) data = svc.getDaily(sym, LocalDate.parse(from), LocalDate.parse(to));
        else if (from != null) data = svc.getDaily(sym, LocalDate.parse(from), LocalDate.now());
        else data = svc.getDaily(sym);
        return ResponseEntity.ok(svc.toCandles(data));
    }

    @GetMapping("/candles/{symbol}/weekly")
    public ResponseEntity<List<Map<String, Object>>> getWeekly(@PathVariable String symbol) {
        return ResponseEntity.ok(svc.toCandles(svc.getWeekly(symbol.toUpperCase())));
    }

    @GetMapping("/symbols")
    public ResponseEntity<List<String>> symbols() { return ResponseEntity.ok(svc.getAvailableSymbols()); }

    @GetMapping("/status/{symbol}")
    public ResponseEntity<Map<String, Object>> status(@PathVariable String symbol) {
        String sym = symbol.toUpperCase();
        return ResponseEntity.ok(Map.of("symbol", sym, "dailyCandles", svc.getCandleCount(sym, "DAILY"), "weeklyCandles", svc.getCandleCount(sym, "WEEKLY")));
    }
}
