package com.alphatrade.ibkr.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class Snapshot {
    private String primaryAccountId;
    private Instant lastSyncAt;
    private List<IbkrPosition> positions;
    private Map<String, AccountSummary> accountSummaries;
}
