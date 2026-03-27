package com.alphatrade.portfolio.service;

import com.alphatrade.common.model.OrderSide;
import com.alphatrade.common.model.Trade;
import com.alphatrade.portfolio.entity.PositionEntity;
import com.alphatrade.portfolio.entity.PositionId;
import com.alphatrade.portfolio.entity.TradeEntity;
import com.alphatrade.portfolio.repository.PositionRepository;
import com.alphatrade.portfolio.repository.TradeRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Trade processing and position management.
 *
 * FIXED from code review:
 *   1. Short position cost basis is now tracked correctly
 *   2. PnL calculation works for both long and short positions
 *   3. Crossing zero (long→short or short→long) handles the flip properly
 *   4. Idempotent trade persistence with proper duplicate detection
 */
@Service
public class PortfolioService {

    private static final Logger log = LoggerFactory.getLogger(PortfolioService.class);

    private final PositionRepository positionRepo;
    private final TradeRepository tradeRepo;

    public PortfolioService(PositionRepository positionRepo, TradeRepository tradeRepo) {
        this.positionRepo = positionRepo;
        this.tradeRepo = tradeRepo;
    }

    @Transactional
    public void processTrade(Trade trade) {
        saveTrade(trade.tradeId() + "-B", trade.buyOrderId(), trade.buyClientId(),
            trade.symbol(), "BUY", trade.qty(), trade.price(), trade);
        saveTrade(trade.tradeId() + "-S", trade.sellOrderId(), trade.sellClientId(),
            trade.symbol(), "SELL", trade.qty(), trade.price(), trade);

        upsertPosition(trade.buyClientId(), trade.symbol(), trade.qty(), trade.price(), OrderSide.BUY);
        upsertPosition(trade.sellClientId(), trade.symbol(), trade.qty(), trade.price(), OrderSide.SELL);

        log.info("Processed trade {} for {}: {} qty={} @ {}",
            trade.tradeId(), trade.symbol(), trade.aggressorSide(), trade.qty(), trade.price());
    }

    private void saveTrade(String tradeId, String orderId, String accountId,
                           String symbol, String side, int qty, BigDecimal price, Trade trade) {
        if (tradeRepo.existsById(tradeId)) {
            log.warn("Duplicate trade {} ignored (idempotency)", tradeId);
            return;
        }
        tradeRepo.save(new TradeEntity(tradeId, orderId, accountId, symbol, side, qty, price, trade.ts()));
    }

    /**
     * Position upsert with correct handling of:
     *   - Adding to long: recalc weighted avg cost
     *   - Reducing long (selling): realize PnL
     *   - Adding to short (selling when flat or already short): track short avg cost
     *   - Covering short (buying to close): realize PnL
     *   - Crossing zero: realize PnL on old side, start new side
     */
    private void upsertPosition(String accountId, String symbol, int qty, BigDecimal price, OrderSide side) {
        PositionId id = new PositionId(accountId, symbol);
        PositionEntity pos = positionRepo.findById(id)
            .orElseGet(() -> new PositionEntity(accountId, symbol));

        BigDecimal notional = price.multiply(BigDecimal.valueOf(qty));
        int currentQty = pos.getQty();

        if (side == OrderSide.BUY) {
            pos.setTotalBuyQty(pos.getTotalBuyQty() + qty);
            pos.setTotalBuyNotional(pos.getTotalBuyNotional().add(notional));

            if (currentQty >= 0) {
                // Adding to long: recalculate weighted average
                BigDecimal existingCost = pos.getAvgPx().multiply(BigDecimal.valueOf(currentQty));
                int newQty = currentQty + qty;
                BigDecimal newAvgPx = newQty > 0
                    ? existingCost.add(notional).divide(BigDecimal.valueOf(newQty), 6, RoundingMode.HALF_UP)
                    : BigDecimal.ZERO;
                pos.setQty(newQty);
                pos.setAvgPx(newAvgPx);
            } else {
                // Covering short: realize PnL = (shortEntry - coverPrice) * qty
                int coverQty = Math.min(qty, Math.abs(currentQty));
                BigDecimal pnl = pos.getAvgPx().subtract(price).multiply(BigDecimal.valueOf(coverQty));
                pos.setRealizedPnl(pos.getRealizedPnl().add(pnl));

                int remaining = currentQty + qty; // currentQty is negative
                if (remaining > 0) {
                    // Crossed zero into long: remaining is new long position at current price
                    pos.setQty(remaining);
                    pos.setAvgPx(price);
                } else if (remaining == 0) {
                    pos.setQty(0);
                    pos.setAvgPx(BigDecimal.ZERO);
                } else {
                    // Still short, just reduced
                    pos.setQty(remaining); // still negative
                    // avgPx stays the same for remaining short
                }
            }
        } else { // SELL
            pos.setTotalSellQty(pos.getTotalSellQty() + qty);
            pos.setTotalSellNotional(pos.getTotalSellNotional().add(notional));

            if (currentQty <= 0) {
                // Adding to short: recalculate weighted average short price
                int absExisting = Math.abs(currentQty);
                BigDecimal existingCost = pos.getAvgPx().multiply(BigDecimal.valueOf(absExisting));
                int newAbsQty = absExisting + qty;
                BigDecimal newAvgPx = newAbsQty > 0
                    ? existingCost.add(notional).divide(BigDecimal.valueOf(newAbsQty), 6, RoundingMode.HALF_UP)
                    : BigDecimal.ZERO;
                pos.setQty(currentQty - qty); // more negative
                pos.setAvgPx(newAvgPx);
            } else {
                // Reducing long: realize PnL = (sellPrice - avgCost) * qty
                int sellQty = Math.min(qty, currentQty);
                BigDecimal pnl = price.subtract(pos.getAvgPx()).multiply(BigDecimal.valueOf(sellQty));
                pos.setRealizedPnl(pos.getRealizedPnl().add(pnl));

                int remaining = currentQty - qty;
                if (remaining < 0) {
                    // Crossed zero into short: remaining is new short at current price
                    pos.setQty(remaining);
                    pos.setAvgPx(price);
                } else if (remaining == 0) {
                    pos.setQty(0);
                    pos.setAvgPx(BigDecimal.ZERO);
                } else {
                    // Still long, just reduced — avgPx stays same
                    pos.setQty(remaining);
                }
            }
        }

        positionRepo.save(pos);
        log.info("Position updated: {} {} qty={} avgPx={} realizedPnl={}",
            accountId, symbol, pos.getQty(), pos.getAvgPx(), pos.getRealizedPnl());
    }
}
