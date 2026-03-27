package com.alphatrade.matching.engine;

import com.alphatrade.common.model.Order;
import com.alphatrade.common.model.OrderBookSnapshot;
import com.alphatrade.common.model.Trade;

import java.util.List;

public record MatchResult(
    List<Trade> trades,
    List<Order> orderUpdates,
    OrderBookSnapshot snapshot
) {}
