package com.alphatrade.portfolio.entity;

import java.io.Serializable;
import java.util.Objects;

public class PositionId implements Serializable {
    private String accountId;
    private String symbol;

    public PositionId() {}
    public PositionId(String accountId, String symbol) {
        this.accountId = accountId;
        this.symbol = symbol;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof PositionId that)) return false;
        return Objects.equals(accountId, that.accountId) && Objects.equals(symbol, that.symbol);
    }

    @Override
    public int hashCode() {
        return Objects.hash(accountId, symbol);
    }
}
