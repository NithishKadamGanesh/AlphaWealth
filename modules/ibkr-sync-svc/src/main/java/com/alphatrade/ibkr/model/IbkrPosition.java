package com.alphatrade.ibkr.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class IbkrPosition {
    private String account;
    private String symbol;
    private String secType;
    private String currency;
    private String exchange;
    private BigDecimal position;
    private BigDecimal avgCost;
    private BigDecimal marketPrice;
    private BigDecimal marketValue;
    private BigDecimal unrealizedPnl;
    private BigDecimal realizedPnl;
    private Instant timestamp;
}
