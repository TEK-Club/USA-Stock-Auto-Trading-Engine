/**
 * Main JavaScript for AT vol.2 Trading Dashboard
 * Core utilities and initialization
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format currency with locale
 */
function formatCurrency(amount, currency = 'KRW') {
    if (currency === 'KRW' || currency === 'krw') {
        return '₩' + Math.round(amount).toLocaleString('ko-KR');
    } else if (currency === 'USD' || currency === 'usd') {
        return '$' + amount.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }
    return amount.toLocaleString();
}

/**
 * Format number with commas
 */
function formatNumber(num, decimals = 0) {
    return num.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

/**
 * Format percentage
 */
function formatPercent(value, decimals = 2) {
    const prefix = value >= 0 ? '+' : '';
    return prefix + value.toFixed(decimals) + '%';
}

/**
 * Format date relative to now
 */
function formatRelativeTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return date.toLocaleDateString();
}

/**
 * Debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function
 */
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ============================================================================
// FETCH HELPERS
// ============================================================================

/**
 * Fetch JSON with error handling
 */
async function fetchJSON(url, options = {}) {
    const defaultOptions = {
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin'
    };
    
    const response = await fetch(url, { ...defaultOptions, ...options });
    
    if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.response = response;
        throw error;
    }
    
    return response.json();
}

/**
 * Post JSON data
 */
async function postJSON(url, data) {
    return fetchJSON(url, {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

// ============================================================================
// DOM HELPERS
// ============================================================================

/**
 * Safe querySelector with null check
 */
function $(selector, context = document) {
    return context.querySelector(selector);
}

/**
 * Safe querySelectorAll
 */
function $$(selector, context = document) {
    return Array.from(context.querySelectorAll(selector));
}

/**
 * Create element with attributes and children
 */
function createElement(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    
    Object.entries(attrs).forEach(([key, value]) => {
        if (key === 'className') {
            el.className = value;
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(el.style, value);
        } else if (key.startsWith('on')) {
            el.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
            el.setAttribute(key, value);
        }
    });
    
    children.forEach(child => {
        if (typeof child === 'string') {
            el.appendChild(document.createTextNode(child));
        } else if (child) {
            el.appendChild(child);
        }
    });
    
    return el;
}

// ============================================================================
// ANIMATION HELPERS
// ============================================================================

/**
 * Animate value change
 */
function animateValue(element, start, end, duration = 500, formatter = null) {
    const range = end - start;
    const startTime = performance.now();
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function (ease-out)
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        const current = start + (range * easeProgress);
        
        element.textContent = formatter ? formatter(current) : Math.round(current);
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}

/**
 * Flash element background
 */
function flashElement(element, color = 'var(--color-primary-light)', duration = 500) {
    const originalBg = element.style.backgroundColor;
    element.style.backgroundColor = color;
    element.style.transition = `background-color ${duration}ms ease`;
    
    setTimeout(() => {
        element.style.backgroundColor = originalBg;
        setTimeout(() => {
            element.style.transition = '';
        }, duration);
    }, 100);
}

// ============================================================================
// THEME MANAGEMENT
// ============================================================================

const ThemeManager = {
    storageKey: 'theme',
    
    init() {
        const saved = localStorage.getItem(this.storageKey);
        if (saved) {
            this.set(saved);
        } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
            this.set('light');
        }
        
        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (localStorage.getItem(this.storageKey) === 'system') {
                document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            }
        });
    },
    
    get() {
        return localStorage.getItem(this.storageKey) || 'dark';
    },
    
    set(theme) {
        localStorage.setItem(this.storageKey, theme);
        
        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else if (theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    },
    
    toggle() {
        const current = this.get();
        this.set(current === 'dark' ? 'light' : 'dark');
    }
};

// ============================================================================
// LOADING STATES
// ============================================================================

const LoadingStates = {
    /**
     * Show skeleton loader in element
     */
    showSkeleton(element, lines = 3) {
        const skeletons = Array(lines).fill(0).map(() => 
            createElement('div', { className: 'skeleton skeleton-text' })
        );
        element.innerHTML = '';
        skeletons.forEach(s => element.appendChild(s));
    },
    
    /**
     * Show spinner in element
     */
    showSpinner(element) {
        element.innerHTML = '';
        element.appendChild(createElement('div', { className: 'spinner' }));
    },
    
    /**
     * Show loading overlay
     */
    showOverlay(container) {
        const overlay = createElement('div', {
            className: 'loading-overlay',
            style: {
                position: 'absolute',
                inset: '0',
                background: 'rgba(15, 15, 26, 0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: '10'
            }
        }, [createElement('div', { className: 'spinner' })]);
        
        container.style.position = 'relative';
        container.appendChild(overlay);
        
        return () => overlay.remove();
    }
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Initialize theme
    ThemeManager.init();
    
    // Add loading animation to links
    $$('a[href^="/"]').forEach(link => {
        link.addEventListener('click', (e) => {
            // Don't show loading for same page or hash links
            if (link.getAttribute('href') === window.location.pathname) {
                return;
            }
            if (link.getAttribute('href').startsWith('#')) {
                return;
            }
            // Add subtle loading indicator to body
            document.body.classList.add('navigating');
        });
    });
    
    // Handle form submissions
    $$('form').forEach(form => {
        form.addEventListener('submit', () => {
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<div class="spinner" style="width: 16px; height: 16px;"></div> Saving...';
            }
        });
    });
    
    console.log('[Main] Dashboard initialized');
});

// Export utilities for global use
window.formatCurrency = formatCurrency;
window.formatNumber = formatNumber;
window.formatPercent = formatPercent;
window.formatRelativeTime = formatRelativeTime;
window.fetchJSON = fetchJSON;
window.postJSON = postJSON;
window.debounce = debounce;
window.throttle = throttle;
window.ThemeManager = ThemeManager;
window.LoadingStates = LoadingStates;
