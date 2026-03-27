package com.alphatrade.apigw.resolver;

import com.alphatrade.apigw.entity.PositionEntity;
import com.alphatrade.apigw.entity.TradeEntity;
import com.alphatrade.apigw.repository.PositionRepository;
import com.alphatrade.apigw.repository.TradeRepository;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.stereotype.Controller;

import java.util.List;

@Controller
public class QueryResolver {

    private final PositionRepository positionRepo;
    private final TradeRepository tradeRepo;

    public QueryResolver(PositionRepository positionRepo, TradeRepository tradeRepo) {
        this.positionRepo = positionRepo;
        this.tradeRepo = tradeRepo;
    }

    @QueryMapping
    public List<PositionEntity> positions(@Argument String accountId) {
        if (accountId != null && !accountId.isBlank()) {
            return positionRepo.findByAccountId(accountId);
        }
        return positionRepo.findAll();
    }

    @QueryMapping
    public List<TradeEntity> trades(@Argument String accountId, @Argument String symbol) {
        if (accountId != null && !accountId.isBlank()) {
            return tradeRepo.findByAccountIdOrderByTsDesc(accountId);
        }
        if (symbol != null && !symbol.isBlank()) {
            return tradeRepo.findBySymbolOrderByTsDesc(symbol);
        }
        return tradeRepo.findAllByOrderByTsDesc();
    }
}
