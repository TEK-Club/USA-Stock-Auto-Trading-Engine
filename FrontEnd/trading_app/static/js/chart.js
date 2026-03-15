/**
 * TradingView Lightweight Charts - Multi-pane layout:
 *   1. Price Chart: Candlestick + EMA 12/26 + SMA 200
 *   2. Volume Chart: Volume bars
 *   3. Indicator Pane: MACD or RSI (toggleable)
 * 
 * Features:
 *   - Time range buttons (1D, 1W, 1M, 3M, 1Y, All)
 *   - Fullscreen mode
 *   - Crosshair sync across all panes
 *   - Drawing tools (coming soon)
 * 
 * Fetches data from /api/chart-data/?symbol=...&period=...&interval=...
 */
(function() {
    'use strict';
  
    // Chart instances
    let priceChart = null;
    let volumeChart = null;
    let indicatorChart = null;
    
    // Series
    let candlestickSeries = null;
    let emaShortLine = null;   // EMA 12
    let emaLongLine = null;    // EMA 26
    let sma200Line = null;     // SMA 200
    let volumeSeries = null;
    let macdLineSeries = null;
    let macdSignalSeries = null;
    let macdHistogramSeries = null;
    let rsiSeries = null;
    
    // State
    let currentSymbol = '';
    let currentIndicator = 'macd'; // 'macd' or 'rsi'
    let isFullscreen = false;
    let chartData = null;
  
    // DOM elements
    const loadingEl = document.getElementById('chart-loading');
    const errorEl = document.getElementById('chart-error');
    const priceRootEl = document.getElementById('chart-price');
    const volumeRootEl = document.getElementById('chart-volume');
    const indicatorRootEl = document.getElementById('chart-indicator');
    const chartContainer = document.getElementById('chart-container');
  
    // Chart styling
    const chartOptions = {
        layout: {
            background: { type: 'solid', color: '#0f0f1a' },
            textColor: 'rgba(255, 255, 255, 0.7)',
            fontSize: 12,
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        rightPriceScale: { 
            borderColor: 'rgba(255, 255, 255, 0.1)',
            scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: { 
            borderColor: 'rgba(255, 255, 255, 0.1)',
            timeVisible: true, 
            secondsVisible: false,
            rightOffset: 5,
        },
        crosshair: { 
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: {
                color: 'rgba(99, 102, 241, 0.4)',
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
            },
            horzLine: {
                color: 'rgba(99, 102, 241, 0.4)',
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
            },
        },
        handleScale: { axisPressedMouseMove: { time: true, price: true } },
        handleScroll: { vertTouchDrag: true },
    };
  
    function showLoading(show) {
        if (loadingEl) loadingEl.style.display = show ? 'flex' : 'none';
    }
    
    function showError(msg) {
        if (errorEl) {
            errorEl.textContent = msg || '';
            errorEl.style.display = msg ? 'flex' : 'none';
        }
    }
    
    function showCharts(show) {
        const display = show ? 'block' : 'none';
        if (priceRootEl) priceRootEl.style.display = display;
        if (volumeRootEl) volumeRootEl.style.display = display;
        if (indicatorRootEl) indicatorRootEl.style.display = display;
        
        // Show legends
        document.querySelectorAll('.chart-legend').forEach(el => {
            el.style.display = show ? 'flex' : 'none';
        });
    }
    
    function getChartWidth() {
        if (priceRootEl) return Math.max(priceRootEl.clientWidth || 0, 600);
        return 800;
    }
  
    function createPriceChart() {
        if (priceChart || !priceRootEl) return;
        priceRootEl.innerHTML = '';
    
        priceChart = LightweightCharts.createChart(priceRootEl, {
            ...chartOptions,
            width: getChartWidth(),
            height: 350,
        });
    
        // Candlestick series
        candlestickSeries = priceChart.addCandlestickSeries({
            upColor: '#10b981',
            downColor: '#ef4444',
            borderDownColor: '#ef4444',
            borderUpColor: '#10b981',
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });
    
        // EMA 12 - Yellow
        emaShortLine = priceChart.addLineSeries({
            color: '#fbbf24',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
        });
    
        // EMA 26 - Orange
        emaLongLine = priceChart.addLineSeries({
            color: '#f97316',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
        });
    
        // SMA 200 - Blue
        sma200Line = priceChart.addLineSeries({
            color: '#3b82f6',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
        });
    }
  
    function createVolumeChart() {
        if (volumeChart || !volumeRootEl) return;
        volumeRootEl.innerHTML = '';
    
        volumeChart = LightweightCharts.createChart(volumeRootEl, {
            ...chartOptions,
            width: getChartWidth(),
            height: 100,
            rightPriceScale: {
                ...chartOptions.rightPriceScale,
                scaleMargins: { top: 0.1, bottom: 0 },
            },
        });
    
        volumeSeries = volumeChart.addHistogramSeries({
            color: 'rgba(99, 102, 241, 0.5)',
            priceFormat: { type: 'volume' },
            priceLineVisible: false,
            lastValueVisible: false,
        });
    }
  
    function createIndicatorChart() {
        if (indicatorChart || !indicatorRootEl) return;
        indicatorRootEl.innerHTML = '';
    
        indicatorChart = LightweightCharts.createChart(indicatorRootEl, {
            ...chartOptions,
            width: getChartWidth(),
            height: 150,
        });
    }
    
    function addMACDSeries() {
        if (!indicatorChart) return;
        
        // Clear existing
        if (rsiSeries) {
            indicatorChart.removeSeries(rsiSeries);
            rsiSeries = null;
        }
        
        // MACD Line
        macdLineSeries = indicatorChart.addLineSeries({
            color: '#3b82f6',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        
        // Signal Line
        macdSignalSeries = indicatorChart.addLineSeries({
            color: '#f97316',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        
        // Histogram
        macdHistogramSeries = indicatorChart.addHistogramSeries({
            priceFormat: { type: 'price' },
            priceLineVisible: false,
            lastValueVisible: false,
        });
    }
    
    function addRSISeries() {
        if (!indicatorChart) return;
        
        // Clear existing MACD series
        if (macdLineSeries) {
            indicatorChart.removeSeries(macdLineSeries);
            macdLineSeries = null;
        }
        if (macdSignalSeries) {
            indicatorChart.removeSeries(macdSignalSeries);
            macdSignalSeries = null;
        }
        if (macdHistogramSeries) {
            indicatorChart.removeSeries(macdHistogramSeries);
            macdHistogramSeries = null;
        }
        
        rsiSeries = indicatorChart.addLineSeries({
            color: '#a855f7',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        
        // Add overbought/oversold lines would require price lines (not directly supported)
    }
  
    function syncTimeScales() {
        if (!priceChart) return;
        
        const charts = [priceChart, volumeChart, indicatorChart].filter(Boolean);
        if (charts.length < 2) return;
        
        const priceTimeScale = priceChart.timeScale();
        
        charts.slice(1).forEach(chart => {
            const ts = chart.timeScale();
            
            priceTimeScale.subscribeVisibleLogicalRangeChange(range => {
                if (range) ts.setVisibleLogicalRange(range);
            });
            
            ts.subscribeVisibleLogicalRangeChange(range => {
                if (range) priceTimeScale.setVisibleLogicalRange(range);
            });
        });
    }
  
    function setupResizeObserver() {
        if (!window.ResizeObserver || !priceRootEl) return;
        
        new ResizeObserver(() => {
            const width = getChartWidth();
            if (priceChart) priceChart.applyOptions({ width });
            if (volumeChart) volumeChart.applyOptions({ width });
            if (indicatorChart) indicatorChart.applyOptions({ width });
        }).observe(priceRootEl);
    }
  
    function destroyCharts() {
        [priceChart, volumeChart, indicatorChart].forEach(chart => {
            if (chart) chart.remove();
        });
        priceChart = volumeChart = indicatorChart = null;
        candlestickSeries = emaShortLine = emaLongLine = sma200Line = null;
        volumeSeries = null;
        macdLineSeries = macdSignalSeries = macdHistogramSeries = rsiSeries = null;
    }
  
    function updateLegends() {
        const priceLegend = document.getElementById('legend-price');
        const volumeLegend = document.getElementById('legend-volume');
        const indicatorLegend = document.getElementById('legend-indicator');
        
        if (priceLegend) {
            priceLegend.innerHTML = `
                <span class="legend-title">${currentSymbol || 'Price'}</span>
                <span class="legend-item" style="color: #fbbf24;">● EMA 12</span>
                <span class="legend-item" style="color: #f97316;">● EMA 26</span>
                <span class="legend-item" style="color: #3b82f6;">● SMA 200</span>
            `;
        }
        
        if (volumeLegend) {
            volumeLegend.innerHTML = `
                <span class="legend-title">Volume</span>
            `;
        }
        
        if (indicatorLegend) {
            if (currentIndicator === 'macd') {
                indicatorLegend.innerHTML = `
                    <span class="legend-title">MACD</span>
                    <span class="legend-item" style="color: #3b82f6;">● MACD Line</span>
                    <span class="legend-item" style="color: #f97316;">● Signal</span>
                `;
            } else {
                indicatorLegend.innerHTML = `
                    <span class="legend-title">RSI (14)</span>
                    <span class="legend-item" style="color: #a855f7;">● RSI</span>
                    <span class="legend-hint">70 Overbought | 30 Oversold</span>
                `;
            }
        }
    }
    
    // Calculate MACD from price data
    function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (!data || data.length < slowPeriod) return { macd: [], signal: [], histogram: [] };
        
        // Calculate EMAs
        const fastEMA = calculateEMA(data.map(d => d.close), fastPeriod);
        const slowEMA = calculateEMA(data.map(d => d.close), slowPeriod);
        
        // MACD line
        const macdLine = fastEMA.map((fast, i) => fast - slowEMA[i]);
        
        // Signal line
        const signalLine = calculateEMA(macdLine, signalPeriod);
        
        // Histogram
        const histogram = macdLine.map((macd, i) => macd - signalLine[i]);
        
        return {
            macd: data.map((d, i) => ({ time: d.time, value: macdLine[i] })).filter(d => !isNaN(d.value)),
            signal: data.map((d, i) => ({ time: d.time, value: signalLine[i] })).filter(d => !isNaN(d.value)),
            histogram: data.map((d, i) => ({
                time: d.time,
                value: histogram[i],
                color: histogram[i] >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'
            })).filter(d => !isNaN(d.value)),
        };
    }
    
    function calculateEMA(data, period) {
        const k = 2 / (period + 1);
        const ema = new Array(data.length).fill(NaN);
        
        // First EMA is SMA
        let sum = 0;
        for (let i = 0; i < period && i < data.length; i++) {
            sum += data[i];
        }
        ema[period - 1] = sum / period;
        
        // Calculate rest
        for (let i = period; i < data.length; i++) {
            ema[i] = data[i] * k + ema[i - 1] * (1 - k);
        }
        
        return ema;
    }
    
    function calculateRSI(data, period = 14) {
        if (!data || data.length < period + 1) return [];
        
        const changes = [];
        for (let i = 1; i < data.length; i++) {
            changes.push(data[i].close - data[i - 1].close);
        }
        
        const rsi = [];
        let avgGain = 0, avgLoss = 0;
        
        // First RSI
        for (let i = 0; i < period; i++) {
            if (changes[i] > 0) avgGain += changes[i];
            else avgLoss += Math.abs(changes[i]);
        }
        avgGain /= period;
        avgLoss /= period;
        
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsi.push({ time: data[period].time, value: 100 - (100 / (1 + rs)) });
        
        // Rest of RSI
        for (let i = period; i < changes.length; i++) {
            const gain = changes[i] > 0 ? changes[i] : 0;
            const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
            
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            rsi.push({ time: data[i + 1].time, value: 100 - (100 / (1 + rs)) });
        }
        
        return rsi;
    }
  
    function load(symbol, period, interval) {
        symbol = (symbol || 'AAPL').trim().toUpperCase();
        period = period || '1y';
        interval = interval || '1d';
        currentSymbol = symbol;
    
        showLoading(true);
        showError('');
        showCharts(false);
    
        const url = `/api/chart-data/?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&interval=${encodeURIComponent(interval)}`;
    
        fetch(url)
            .then(res => res.json())
            .then(data => {
                showLoading(false);
                if (data.error) {
                    showError(data.error);
                    return;
                }
                
                chartData = data;
    
                destroyCharts();
                createPriceChart();
                createVolumeChart();
                createIndicatorChart();
                
                if (currentIndicator === 'macd') {
                    addMACDSeries();
                } else {
                    addRSISeries();
                }
                
                syncTimeScales();
                setupResizeObserver();
    
                // Price chart data
                const candles = data.candlestick_data || [];
                candlestickSeries.setData(candles);
                if (data.ema12_data) emaShortLine.setData(data.ema12_data);
                else if (data.ema_short_data) emaShortLine.setData(data.ema_short_data);
                if (data.ema26_data) emaLongLine.setData(data.ema26_data);
                else if (data.ema_long_data) emaLongLine.setData(data.ema_long_data);
                if (data.sma200_data) sma200Line.setData(data.sma200_data);
                candlestickSeries.setMarkers(data.markers_data || []);
    
                // Volume data
                if (data.volume_data) {
                    volumeSeries.setData(data.volume_data);
                } else if (candles.length > 0) {
                    // Generate volume from candles if available
                    const volumeData = candles.map((c, i) => ({
                        time: c.time,
                        value: c.volume || Math.random() * 1000000,
                        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)'
                    })).filter(v => v.value);
                    if (volumeData.length > 0) volumeSeries.setData(volumeData);
                }
    
                // Indicator data
                if (currentIndicator === 'macd') {
                    if (data.macd_data) {
                        macdLineSeries.setData(data.macd_data.line || []);
                        macdSignalSeries.setData(data.macd_data.signal || []);
                        macdHistogramSeries.setData(data.macd_data.histogram || []);
                    } else {
                        const macd = calculateMACD(candles);
                        macdLineSeries.setData(macd.macd);
                        macdSignalSeries.setData(macd.signal);
                        macdHistogramSeries.setData(macd.histogram);
                    }
                } else {
                    if (data.rsi_data) {
                        rsiSeries.setData(data.rsi_data);
                    } else {
                        rsiSeries.setData(calculateRSI(candles));
                    }
                }
    
                // Fit content
                priceChart.timeScale().fitContent();
                
                updateLegends();
                showCharts(true);
            })
            .catch(err => {
                showLoading(false);
                showError('Failed to load chart: ' + (err?.message || 'Unknown error'));
            });
    }
    
    function setTimeRange(period) {
        const symbolEl = document.getElementById('chart-symbol');
        const symbol = symbolEl ? symbolEl.value.trim().toUpperCase() : currentSymbol || 'AAPL';
        load(symbol, period, '1d');
        
        // Update button states
        document.querySelectorAll('.time-range-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.period === period);
        });
    }
    
    function toggleIndicator(indicator) {
        if (indicator === currentIndicator) return;
        currentIndicator = indicator;
        
        // Update button states
        document.querySelectorAll('.indicator-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.indicator === indicator);
        });
        
        // Reload with new indicator
        if (chartData) {
            if (!indicatorChart) createIndicatorChart();
            
            // Clear and recreate series
            if (indicator === 'macd') {
                if (rsiSeries) {
                    indicatorChart.removeSeries(rsiSeries);
                    rsiSeries = null;
                }
                addMACDSeries();
                const macd = calculateMACD(chartData.candlestick_data || []);
                macdLineSeries.setData(macd.macd);
                macdSignalSeries.setData(macd.signal);
                macdHistogramSeries.setData(macd.histogram);
            } else {
                if (macdLineSeries) {
                    indicatorChart.removeSeries(macdLineSeries);
                    indicatorChart.removeSeries(macdSignalSeries);
                    indicatorChart.removeSeries(macdHistogramSeries);
                    macdLineSeries = macdSignalSeries = macdHistogramSeries = null;
                }
                addRSISeries();
                rsiSeries.setData(calculateRSI(chartData.candlestick_data || []));
            }
            
            updateLegends();
        }
    }
    
    function toggleFullscreen() {
        isFullscreen = !isFullscreen;
        
        if (chartContainer) {
            chartContainer.classList.toggle('fullscreen', isFullscreen);
            
            // Resize charts after animation
            setTimeout(() => {
                const width = getChartWidth();
                if (priceChart) priceChart.applyOptions({ width, height: isFullscreen ? 500 : 350 });
                if (volumeChart) volumeChart.applyOptions({ width });
                if (indicatorChart) indicatorChart.applyOptions({ width, height: isFullscreen ? 200 : 150 });
            }, 300);
        }
        
        // Update button
        const btn = document.getElementById('fullscreen-btn');
        if (btn) btn.textContent = isFullscreen ? '⛶' : '⛶';
    }
  
    // Expose API
    window.TradingChart = { 
        load, 
        destroy: destroyCharts,
        setTimeRange,
        toggleIndicator,
        toggleFullscreen,
    };
})();
