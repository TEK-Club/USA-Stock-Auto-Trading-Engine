/**
 * Mini Sparkline Charts for Position Tables
 * 
 * Creates small inline charts showing price history
 * Uses HTML5 Canvas for lightweight rendering
 */
(function() {
    'use strict';
    
    const SPARKLINE_WIDTH = 100;
    const SPARKLINE_HEIGHT = 30;
    const LINE_COLOR_UP = '#10b981';
    const LINE_COLOR_DOWN = '#ef4444';
    const FILL_OPACITY = 0.1;
    
    /**
     * Create a sparkline chart in a canvas element
     * @param {HTMLCanvasElement} canvas - Canvas element
     * @param {number[]} data - Array of price values
     * @param {Object} options - Optional configuration
     */
    function drawSparkline(canvas, data, options = {}) {
        if (!canvas || !data || data.length < 2) return;
        
        const ctx = canvas.getContext('2d');
        const width = options.width || SPARKLINE_WIDTH;
        const height = options.height || SPARKLINE_HEIGHT;
        const dpr = window.devicePixelRatio || 1;
        
        // Set canvas size
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.scale(dpr, dpr);
        
        // Calculate bounds
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const padding = height * 0.1;
        
        // Determine color based on trend
        const isUp = data[data.length - 1] >= data[0];
        const lineColor = options.lineColor || (isUp ? LINE_COLOR_UP : LINE_COLOR_DOWN);
        
        // Calculate points
        const points = data.map((value, i) => ({
            x: (i / (data.length - 1)) * width,
            y: padding + ((max - value) / range) * (height - padding * 2)
        }));
        
        // Draw fill gradient
        ctx.beginPath();
        ctx.moveTo(points[0].x, height);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, height);
        ctx.closePath();
        
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, lineColor.replace(')', `, ${FILL_OPACITY})`).replace('rgb', 'rgba'));
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Draw line
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        
        // Draw end dot
        const lastPoint = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();
    }
    
    /**
     * Load sparkline data for a symbol and render
     * @param {HTMLCanvasElement} canvas - Canvas element
     * @param {string} symbol - Stock symbol
     */
    async function loadSparkline(canvas, symbol) {
        if (!canvas || !symbol) return;
        
        // Show loading state
        canvas.style.opacity = '0.5';
        
        try {
            // Try to get data from chart API (7 days)
            const response = await fetch(`/api/chart-data/?symbol=${encodeURIComponent(symbol)}&period=7d&interval=1h`);
            
            if (!response.ok) {
                throw new Error('Failed to load data');
            }
            
            const data = await response.json();
            
            if (data.error || !data.candlestick_data || data.candlestick_data.length < 2) {
                // Try with 1 month data
                const response2 = await fetch(`/api/chart-data/?symbol=${encodeURIComponent(symbol)}&period=1mo&interval=1d`);
                const data2 = await response2.json();
                
                if (data2.candlestick_data && data2.candlestick_data.length >= 2) {
                    const prices = data2.candlestick_data.map(d => d.close);
                    drawSparkline(canvas, prices);
                }
            } else {
                const prices = data.candlestick_data.map(d => d.close);
                drawSparkline(canvas, prices);
            }
        } catch (error) {
            console.warn(`Failed to load sparkline for ${symbol}:`, error);
            // Draw a flat line as fallback
            drawSparkline(canvas, [1, 1], { lineColor: 'rgba(255,255,255,0.2)' });
        }
        
        canvas.style.opacity = '1';
    }
    
    /**
     * Initialize all sparklines on the page
     */
    function initSparklines() {
        const sparklines = document.querySelectorAll('[data-sparkline]');
        
        sparklines.forEach(canvas => {
            const symbol = canvas.dataset.sparkline;
            if (symbol) {
                loadSparkline(canvas, symbol);
            }
        });
    }
    
    /**
     * Create a sparkline element for a symbol
     * @param {string} symbol - Stock symbol
     * @returns {HTMLCanvasElement}
     */
    function createSparklineElement(symbol) {
        const canvas = document.createElement('canvas');
        canvas.className = 'sparkline';
        canvas.dataset.sparkline = symbol;
        canvas.style.display = 'block';
        return canvas;
    }
    
    // Auto-initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', initSparklines);
    
    // Expose API
    window.Sparkline = {
        draw: drawSparkline,
        load: loadSparkline,
        init: initSparklines,
        create: createSparklineElement,
    };
})();
