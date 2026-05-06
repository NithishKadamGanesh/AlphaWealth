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
public class AccountSummary {
    private String account;
    private String currency;
    private BigDecimal netLiquidation;
    private BigDecimal totalCash;
    private BigDecimal buyingPower;
    private BigDecimal grossPositionValue;
    private BigDecimal initMarginReq;
    private BigDecimal maintMarginReq;
    private BigDecimal availableFunds;
    private BigDecimal excessLiquidity;
    private Instant timestamp;
}
