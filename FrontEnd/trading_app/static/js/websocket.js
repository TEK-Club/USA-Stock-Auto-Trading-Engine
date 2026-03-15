/**
 * Real-time Updates Module for AT vol.2 Trading Dashboard
 * 
 * Provides real-time position and P&L updates using:
 * - Server-Sent Events (SSE) when available
 * - Polling fallback for Django (30-second intervals)
 * 
 * Usage:
 *   import { RealTimeUpdater } from './websocket.js';
 *   const updater = new RealTimeUpdater();
 *   updater.connect();
 */

class RealTimeUpdater {
    constructor(options = {}) {
        this.pollInterval = options.pollInterval || 30000; // 30 seconds
        this.apiEndpoint = options.apiEndpoint || '/api/balance/';
        this.positionsEndpoint = options.positionsEndpoint || '/api/positions/';
        this.onUpdate = options.onUpdate || null;
        this.onConnect = options.onConnect || null;
        this.onDisconnect = options.onDisconnect || null;
        this.onError = options.onError || null;
        
        this._pollTimer = null;
        this._connected = false;
        this._lastData = null;
        this._retryCount = 0;
        this._maxRetries = 5;
        this._retryDelay = 5000;
    }
    
    /**
     * Start real-time updates
     */
    connect() {
        this._connected = true;
        this._retryCount = 0;
        this._updateConnectionStatus('connecting');
        
        // Start polling immediately
        this._poll();
        
        // Set up interval
        this._pollTimer = setInterval(() => this._poll(), this.pollInterval);
        
        console.log('[RealTime] Connected - polling every', this.pollInterval / 1000, 'seconds');
    }
    
    /**
     * Stop real-time updates
     */
    disconnect() {
        this._connected = false;
        
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        
        this._updateConnectionStatus('disconnected');
        
        if (this.onDisconnect) {
            this.onDisconnect();
        }
        
        console.log('[RealTime] Disconnected');
    }
    
    /**
     * Force an immediate update
     */
    refresh() {
        return this._poll();
    }
    
    /**
     * Check if connected
     */
    isConnected() {
        return this._connected;
    }
    
    /**
     * Internal: Perform a poll request
     */
    async _poll() {
        if (!this._connected) return;
        
        try {
            const response = await fetch(this.apiEndpoint, {
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'same-origin'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            // Check if data changed
            const dataStr = JSON.stringify(data);
            const hasChanged = dataStr !== JSON.stringify(this._lastData);
            
            this._lastData = data;
            this._retryCount = 0;
            this._updateConnectionStatus('connected');
            
            // Trigger update callback
            if (this.onUpdate && hasChanged) {
                this.onUpdate(data);
            }
            
            // Update DOM elements
            this._updateDOM(data);
            
            return data;
            
        } catch (error) {
            console.error('[RealTime] Poll failed:', error);
            this._retryCount++;
            
            if (this._retryCount >= this._maxRetries) {
                this._updateConnectionStatus('disconnected');
                if (this.onError) {
                    this.onError(error);
                }
            } else {
                this._updateConnectionStatus('reconnecting');
            }
            
            return null;
        }
    }
    
    /**
     * Internal: Update DOM elements with new data
     */
    _updateDOM(data) {
        // Update position count
        const posCountEl = document.getElementById('position-count');
        if (posCountEl && data.position_count !== undefined) {
            posCountEl.textContent = data.position_count;
        }
        
        // Update total value
        const totalValueEl = document.getElementById('total-value');
        if (totalValueEl && data.total_positions_value_usd !== undefined) {
            totalValueEl.textContent = '$' + data.total_positions_value_usd.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        }
        
        // Update total P&L
        const totalPnlEl = document.getElementById('total-pnl');
        if (totalPnlEl && data.total_unrealized_pnl_krw !== undefined) {
            const pnl = data.total_unrealized_pnl_krw;
            const prefix = pnl >= 0 ? '+' : '';
            totalPnlEl.textContent = prefix + '₩' + Math.abs(pnl).toLocaleString('ko-KR');
            totalPnlEl.className = 'stat-value font-mono ' + (pnl >= 0 ? 'positive' : 'negative');
        }
        
        // Update realized P&L
        const realizedPnlEl = document.getElementById('realized-pnl');
        if (realizedPnlEl && data.realized_pnl_krw !== undefined) {
            const pnl = data.realized_pnl_krw;
            const prefix = pnl >= 0 ? '+' : '';
            realizedPnlEl.textContent = prefix + '₩' + Math.abs(pnl).toLocaleString('ko-KR');
            realizedPnlEl.className = 'stat-value font-mono ' + (pnl >= 0 ? 'positive' : 'negative');
        }
        
        // Update last updated time
        const lastUpdateEl = document.getElementById('last-update');
        if (lastUpdateEl) {
            lastUpdateEl.textContent = new Date().toLocaleTimeString();
        }
    }
    
    /**
     * Internal: Update connection status indicator
     */
    _updateConnectionStatus(status) {
        const statusEl = document.getElementById('connection-status');
        if (!statusEl) return;
        
        const dotEl = statusEl.querySelector('.status-dot');
        const textEl = statusEl.querySelector('.status-text');
        
        statusEl.className = 'connection-status ' + status;
        
        if (textEl) {
            switch (status) {
                case 'connected':
                    textEl.textContent = 'Live';
                    break;
                case 'connecting':
                    textEl.textContent = 'Connecting...';
                    break;
                case 'reconnecting':
                    textEl.textContent = 'Reconnecting...';
                    break;
                case 'disconnected':
                    textEl.textContent = 'Disconnected';
                    break;
            }
        }
        
        if (this.onConnect && status === 'connected') {
            this.onConnect();
        }
    }
}

/**
 * Toast Notification System
 */
class ToastManager {
    constructor(containerId = 'toast-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = containerId;
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
        this.defaultDuration = 5000;
    }
    
    /**
     * Show a toast notification
     * @param {string} type - 'success', 'error', 'warning', 'info'
     * @param {string} title - Toast title
     * @param {string} message - Toast message
     * @param {number} duration - Auto-dismiss time in ms (0 = no auto-dismiss)
     */
    show(type, title, message, duration = this.defaultDuration) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" aria-label="Close">✕</button>
        `;
        
        // Add close handler
        toast.querySelector('.toast-close').addEventListener('click', () => {
            this._removeToast(toast);
        });
        
        this.container.appendChild(toast);
        
        // Auto-dismiss
        if (duration > 0) {
            setTimeout(() => this._removeToast(toast), duration);
        }
        
        return toast;
    }
    
    success(title, message, duration) {
        return this.show('success', title, message, duration);
    }
    
    error(title, message, duration) {
        return this.show('error', title, message, duration);
    }
    
    warning(title, message, duration) {
        return this.show('warning', title, message, duration);
    }
    
    info(title, message, duration) {
        return this.show('info', title, message, duration);
    }
    
    _removeToast(toast) {
        toast.classList.add('removing');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }
}

/**
 * Notification Center
 */
class NotificationCenter {
    constructor() {
        this.notifications = JSON.parse(localStorage.getItem('notifications') || '[]');
        this.maxNotifications = 50;
        this._bindEvents();
        this._updateBadge();
    }
    
    /**
     * Add a notification
     */
    add(type, title, message) {
        const notification = {
            id: Date.now(),
            type,
            title,
            message,
            timestamp: new Date().toISOString(),
            read: false
        };
        
        this.notifications.unshift(notification);
        
        // Trim old notifications
        if (this.notifications.length > this.maxNotifications) {
            this.notifications = this.notifications.slice(0, this.maxNotifications);
        }
        
        this._save();
        this._updateBadge();
        this._renderList();
        
        return notification;
    }
    
    /**
     * Mark notification as read
     */
    markRead(id) {
        const notification = this.notifications.find(n => n.id === id);
        if (notification) {
            notification.read = true;
            this._save();
            this._updateBadge();
            this._renderList();
        }
    }
    
    /**
     * Mark all as read
     */
    markAllRead() {
        this.notifications.forEach(n => n.read = true);
        this._save();
        this._updateBadge();
        this._renderList();
    }
    
    /**
     * Clear all notifications
     */
    clear() {
        this.notifications = [];
        this._save();
        this._updateBadge();
        this._renderList();
    }
    
    /**
     * Get unread count
     */
    getUnreadCount() {
        return this.notifications.filter(n => !n.read).length;
    }
    
    _save() {
        localStorage.setItem('notifications', JSON.stringify(this.notifications));
    }
    
    _updateBadge() {
        const badge = document.getElementById('notification-count');
        if (badge) {
            const count = this.getUnreadCount();
            badge.textContent = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        }
    }
    
    _renderList() {
        const list = document.getElementById('notification-list');
        if (!list) return;
        
        if (this.notifications.length === 0) {
            list.innerHTML = `
                <div style="padding: var(--space-8); text-align: center; color: var(--color-text-muted);">
                    No notifications
                </div>
            `;
            return;
        }
        
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ',
            trade: '📊'
        };
        
        list.innerHTML = this.notifications.slice(0, 10).map(n => `
            <div class="notification-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
                <span class="toast-icon" style="color: var(--color-${n.type === 'success' ? 'primary' : n.type === 'error' ? 'danger' : n.type === 'warning' ? 'warning' : 'info'});">
                    ${icons[n.type] || icons.info}
                </span>
                <div style="flex: 1;">
                    <div style="font-weight: 500; margin-bottom: 2px;">${n.title}</div>
                    <div style="font-size: var(--font-size-sm); color: var(--color-text-secondary);">${n.message}</div>
                    <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 4px;">
                        ${this._formatTime(n.timestamp)}
                    </div>
                </div>
            </div>
        `).join('');
        
        // Add click handlers
        list.querySelectorAll('.notification-item').forEach(item => {
            item.addEventListener('click', () => {
                this.markRead(parseInt(item.dataset.id));
            });
        });
    }
    
    _formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return date.toLocaleDateString();
    }
    
    _bindEvents() {
        const clearBtn = document.getElementById('clear-notifications');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clear());
        }
    }
}

// Initialize global instances
window.realTimeUpdater = null;
window.toastManager = null;
window.notificationCenter = null;

// Auto-initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Toast Manager
    window.toastManager = new ToastManager();
    
    // Initialize Notification Center
    window.notificationCenter = new NotificationCenter();
    
    // Initialize Real-Time Updater
    window.realTimeUpdater = new RealTimeUpdater({
        pollInterval: 30000,
        onUpdate: (data) => {
            console.log('[RealTime] Data updated:', data);
        },
        onConnect: () => {
            console.log('[RealTime] Connected');
        },
        onDisconnect: () => {
            window.toastManager?.warning('Connection Lost', 'Real-time updates paused');
        },
        onError: (error) => {
            window.toastManager?.error('Update Failed', error.message);
        }
    });
    
    // Start real-time updates
    window.realTimeUpdater.connect();
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RealTimeUpdater, ToastManager, NotificationCenter };
}
