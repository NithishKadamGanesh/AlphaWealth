package com.alphatrade.analysis.signal;

import com.alphatrade.analysis.indicator.IndicatorEngine;
import com.alphatrade.analysis.indicator.SupportResistanceDetector;
import com.alphatrade.analysis.indicator.SupportResistanceDetector.Level;
import com.alphatrade.analysis.model.Candle;
import com.alphatrade.analysis.pattern.PatternDetector;
import com.alphatrade.analysis.pattern.PatternDetector.Pattern;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class SignalGenerator {

    public record TradeSignal(String symbol, String action, String rationale, double entryLow, double entryHigh,
        double target, double stopLoss, double confidence, double riskReward,
        List<String> bullFactors, List<String> bearFactors, Map<String, Object> indicators) {}

    private final IndicatorEngine ind;
    private final PatternDetector pat;
    private final SupportResistanceDetector sr;

    public SignalGenerator(IndicatorEngine ind, PatternDetector pat, SupportResistanceDetector sr) {
        this.ind = ind; this.pat = pat; this.sr = sr;
    }

    public TradeSignal generate(String symbol, List<Candle> candles) {
        if (candles.size() < 50) return new TradeSignal(symbol,"HOLD","Insufficient data",0,0,0,0,0,0,List.of(),List.of(),Map.of());
        int last = candles.size()-1; double px = candles.get(last).close();
        double[] sma20=ind.sma(candles,20), sma50=ind.sma(candles,50), sma200=ind.sma(candles,200), rsi=ind.rsi(candles,14);
        Map<String,double[]> macd=ind.macd(candles), boll=ind.bollinger(candles); double[] atr=ind.atr(candles);
        Map<String,double[]> stoch=ind.stochastic(candles);
        double rN=v(rsi,last), mH=v(macd.get("histogram"),last), mHP=v(macd.get("histogram"),last-1);
        double bPB=v(boll.get("pctB"),last), aN=v(atr,last), sK=v(stoch.get("k"),last);
        double s20=v(sma20,last), s50=v(sma50,last), s200=v(sma200,last);

        List<String> bull=new ArrayList<>(), bear=new ArrayList<>(); double score=0;
        if(px>s20&&!Double.isNaN(s20)){score+=0.1;bull.add("Price > SMA20");}else if(!Double.isNaN(s20)){score-=0.1;bear.add("Price < SMA20");}
        if(px>s50&&!Double.isNaN(s50)){score+=0.1;bull.add("Price > SMA50");}else if(!Double.isNaN(s50)){score-=0.1;bear.add("Price < SMA50");}
        if(px>s200&&!Double.isNaN(s200)){score+=0.15;bull.add("Above SMA200 (bullish structure)");}else if(!Double.isNaN(s200)){score-=0.15;bear.add("Below SMA200 (bearish)");}
        if(s20>s50&&!Double.isNaN(s20)&&!Double.isNaN(s50)){score+=0.1;bull.add("SMA20 > SMA50");}
        if(rN<30){score+=0.15;bull.add(String.format("RSI oversold (%.1f)",rN));}else if(rN>70){score-=0.15;bear.add(String.format("RSI overbought (%.1f)",rN));}else if(rN>50)score+=0.05;
        if(!Double.isNaN(mH)&&!Double.isNaN(mHP)){
            if(mH>0&&mHP<=0){score+=0.15;bull.add("MACD bullish crossover");}else if(mH<0&&mHP>=0){score-=0.15;bear.add("MACD bearish crossover");}
            else if(mH>mHP)score+=0.05; else score-=0.05;
        }
        if(bPB<0.05){score+=0.1;bull.add("At lower Bollinger Band");}else if(bPB>0.95){score-=0.1;bear.add("At upper Bollinger Band");}
        if(sK<20){score+=0.1;bull.add("Stochastic oversold");}else if(sK>80){score-=0.1;bear.add("Stochastic overbought");}

        for(Pattern p:pat.detectAll(candles)){if(p.endIdx()>=last-5){
            if("BULLISH".equals(p.bias())){score+=p.confidence()*0.1;bull.add(p.name()+" pattern");}
            else if("BEARISH".equals(p.bias())){score-=p.confidence()*0.1;bear.add(p.name()+" pattern");}}}

        List<Level> levels=sr.detect(candles);
        double nearSup=levels.stream().filter(l->"SUPPORT".equals(l.type())&&l.price()<px).mapToDouble(Level::price).max().orElse(px-aN*2);
        double nearRes=levels.stream().filter(l->"RESISTANCE".equals(l.type())&&l.price()>px).mapToDouble(Level::price).min().orElse(px+aN*3);

        double conf=Math.max(0,Math.min(1,0.5+score));
        String action=score>0.2?"BUY":score<-0.2?"SELL":"HOLD";
        double eL,eH,tgt,sl;
        if("BUY".equals(action)){eL=px-aN*0.3;eH=px+aN*0.2;tgt=nearRes;sl=nearSup-aN*0.5;}
        else if("SELL".equals(action)){eH=px+aN*0.3;eL=px-aN*0.2;tgt=nearSup;sl=nearRes+aN*0.5;}
        else{eL=px;eH=px;tgt=px;sl=px;}
        double risk=Math.abs(px-sl), reward=Math.abs(tgt-px), rr=risk>0?reward/risk:0;
        String rat=String.format("%s %s — %.0f%% confidence | %d bull vs %d bear | R:R %.1f:1",action,symbol,conf*100,bull.size(),bear.size(),rr);
        Map<String,Object> snap=new LinkedHashMap<>();
        snap.put("price",r(px));snap.put("rsi14",r(rN));snap.put("macdHist",r(mH));snap.put("bollPctB",r(bPB));
        snap.put("stochK",r(sK));snap.put("atr14",r(aN));snap.put("sma20",r(s20));snap.put("sma50",r(s50));snap.put("sma200",r(s200));
        return new TradeSignal(symbol,action,rat,r(eL),r(eH),r(tgt),r(sl),r(conf),r(rr),bull,bear,snap);
    }

    private double v(double[] a, int i){return(i>=0&&i<a.length)?a[i]:Double.NaN;}
    private double r(double v){return Double.isNaN(v)?0:Math.round(v*100.0)/100.0;}
}
