package com.alphatrade.analysis.entity;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * A single symbol on the user's watchlist. Durable replacement for the
 * browser-localStorage watchlist so it survives reloads and is usable
 * server-side (scans, alerts). Ordering is preserved via {@code sortOrder}.
 */
@Entity
@Table(name = "watchlist_items")
public class WatchlistItemEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 16)
    private String symbol;

    @Column(nullable = false)
    private int sortOrder;

    @Column(nullable = false)
    private Instant addedAt = Instant.now();

    public WatchlistItemEntity() {}

    public WatchlistItemEntity(String symbol, int sortOrder) {
        this.symbol = symbol;
        this.sortOrder = sortOrder;
        this.addedAt = Instant.now();
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }
    public int getSortOrder() { return sortOrder; }
    public void setSortOrder(int sortOrder) { this.sortOrder = sortOrder; }
    public Instant getAddedAt() { return addedAt; }
    public void setAddedAt(Instant addedAt) { this.addedAt = addedAt; }
}
