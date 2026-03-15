"""
Dashboard - FastAPI web dashboard for monitoring and control.
Includes session-based authentication and real-time updates.
"""

import os
import secrets
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, Depends, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel
import uvicorn

# Session storage (in production, use Redis or database)
sessions: Dict[str, Dict[str, Any]] = {}

# Security
security = HTTPBasic()

app = FastAPI(
    title="USA Auto Trader Dashboard",
    description="Trading system monitoring dashboard",
    version="1.0.0"
)

# Templates directory
templates_dir = os.path.join(os.path.dirname(__file__), "templates")
if os.path.exists(templates_dir):
    templates = Jinja2Templates(directory=templates_dir)
else:
    templates = None


class DashboardConfig:
    """Dashboard configuration"""
    def __init__(self):
        self.host = os.getenv("DASHBOARD_HOST", "127.0.0.1")
        self.port = int(os.getenv("DASHBOARD_PORT", "8000"))
        self.username = os.getenv("DASHBOARD_USER", "admin")
        self.password = os.getenv("DASHBOARD_PASS", "changeme")
        self.allowed_ips = os.getenv("DASHBOARD_ALLOWED_IPS", "127.0.0.1").split(",")
        self.session_timeout = int(os.getenv("DASHBOARD_SESSION_TIMEOUT", "30"))  # minutes


config = DashboardConfig()


# Trader reference (set from main.py)
trader = None


def set_trader(trader_instance: Any) -> None:
    """Set the trader instance for dashboard access"""
    global trader
    trader = trader_instance


def verify_ip(request: Request) -> bool:
    """Verify client IP is allowed"""
    client_ip = request.client.host
    return client_ip in config.allowed_ips or "0.0.0.0" in config.allowed_ips


def create_session(username: str) -> str:
    """Create a new session"""
    session_id = secrets.token_urlsafe(32)
    sessions[session_id] = {
        "username": username,
        "created_at": datetime.now(),
        "expires_at": datetime.now() + timedelta(minutes=config.session_timeout)
    }
    return session_id


def verify_session(request: Request) -> Optional[Dict]:
    """Verify session from cookie"""
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in sessions:
        return None
    
    session = sessions[session_id]
    if datetime.now() > session["expires_at"]:
        del sessions[session_id]
        return None
    
    # Extend session
    session["expires_at"] = datetime.now() + timedelta(minutes=config.session_timeout)
    return session


def require_auth(request: Request) -> Dict:
    """Dependency to require authentication"""
    session = verify_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return session


# ===== Routes =====

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Dashboard home page"""
    session = verify_session(request)
    if not session:
        return RedirectResponse(url="/login")
    
    if templates:
        return templates.TemplateResponse("index.html", {
            "request": request,
            "title": "Dashboard"
        })
    
    return HTMLResponse(content=generate_dashboard_html())


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Login page"""
    return HTMLResponse(content=generate_login_html())


@app.post("/login")
async def login(request: Request, response: Response):
    """Handle login"""
    form_data = await request.form()
    username = form_data.get("username")
    password = form_data.get("password")
    
    if username == config.username and password == config.password:
        session_id = create_session(username)
        response = RedirectResponse(url="/", status_code=302)
        response.set_cookie(
            key="session_id",
            value=session_id,
            httponly=True,
            max_age=config.session_timeout * 60
        )
        return response
    
    raise HTTPException(status_code=401, detail="Invalid credentials")


@app.get("/logout")
async def logout(request: Request):
    """Handle logout"""
    session_id = request.cookies.get("session_id")
    if session_id and session_id in sessions:
        del sessions[session_id]
    
    response = RedirectResponse(url="/login")
    response.delete_cookie("session_id")
    return response


# ===== API Endpoints =====

@app.get("/api/status")
async def get_status(session: Dict = Depends(require_auth)):
    """Get system status"""
    if not trader:
        return {"error": "Trader not connected"}
    
    try:
        return {
            "mode": trader.config.mode if trader.config else "unknown",
            "is_running": trader.is_running,
            "market_status": trader.market_hours.get_status_dict() if trader.market_hours else {},
            "balance": trader.balance_tracker.get_summary() if trader.balance_tracker else {},
            "circuit_breaker": trader.circuit_breaker.get_status() if trader.circuit_breaker else {},
            "health": trader.health_monitor.get_status() if trader.health_monitor else {}
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/positions")
async def get_positions(session: Dict = Depends(require_auth)):
    """Get current positions"""
    if not trader or not trader.balance_tracker:
        return {"positions": []}
    
    try:
        positions = trader.balance_tracker.get_all_positions()
        return {
            "positions": [
                {
                    "symbol": symbol,
                    "quantity": pos.quantity,
                    "avg_price": pos.avg_price,
                    "current_price": pos.current_price,
                    "unrealized_pnl": pos.unrealized_pnl,
                    "unrealized_pnl_percent": pos.unrealized_pnl_percent
                }
                for symbol, pos in positions.items()
            ]
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/orders")
async def get_orders(session: Dict = Depends(require_auth)):
    """Get recent orders"""
    if not trader or not trader.order_manager:
        return {"orders": []}
    
    try:
        orders = trader.order_manager.active_orders
        return {
            "orders": [
                order.to_dict() for order in orders.values()
            ]
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/pnl")
async def get_pnl(session: Dict = Depends(require_auth)):
    """Get P&L data"""
    if not trader or not trader.database:
        return {"pnl": {}}
    
    try:
        daily_pnl = trader.database.get_daily_pnl()
        return {
            "realized_pnl_krw": daily_pnl.realized_pnl_krw if daily_pnl else 0,
            "unrealized_pnl_krw": trader.balance_tracker.get_unrealized_pnl() if trader.balance_tracker else 0,
            "total_trades": daily_pnl.total_trades if daily_pnl else 0,
            "win_rate": daily_pnl.win_rate if daily_pnl else 0
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/chart-data")
async def get_chart_data(
    symbol: str,
    period: str = "1y",
    interval: str = "1d",
    session: Dict = Depends(require_auth),
):
    """
    Export strategy data in JSON format for TradingView Lightweight Charts.

    - **symbol** (required): Stock symbol (e.g. AAPL)
    - **period** (optional): Time period (default: 1y)
    - **interval** (optional): Data interval (default: 1d)

    Returns candlestick_data, ema12_data, ema26_data, sma200_data, markers_data.
    Times are UNIX timestamps in seconds. Markers come from Buy_Signal column when present.
    """
    if not trader:
        raise HTTPException(status_code=503, detail="Trader not connected")
    if not trader.kis_api or not trader.strategy:
        raise HTTPException(status_code=503, detail="Trader components not available")

    symbol = symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")

    hist = trader.kis_api.get_historical_data(symbol, period=period, interval=interval)
    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail=f"No data for symbol {symbol}")

    df = trader.strategy.calculate_indicators(hist.copy())

    def _unix_sec(ts) -> int:
        t = ts if hasattr(ts, "timestamp") else pd.Timestamp(ts)
        return int(t.timestamp())

    candlestick_data = []
    for ts, row in df.iterrows():
        o, h, l, c = row.get("Open"), row.get("High"), row.get("Low"), row.get("Close")
        if pd.notna(o) and pd.notna(h) and pd.notna(l) and pd.notna(c):
            candlestick_data.append({
                "time": _unix_sec(ts),
                "open": round(float(o), 4),
                "high": round(float(h), 4),
                "low": round(float(l), 4),
                "close": round(float(c), 4),
            })

    ema12_data = [
        {"time": _unix_sec(ts), "value": round(float(row["EMA_12"]), 4)}
        for ts, row in df.iterrows()
        if "EMA_12" in row and pd.notna(row.get("EMA_12"))
    ]
    ema26_data = [
        {"time": _unix_sec(ts), "value": round(float(row["EMA_26"]), 4)}
        for ts, row in df.iterrows()
        if "EMA_26" in row and pd.notna(row.get("EMA_26"))
    ]
    sma200_data = [
        {"time": _unix_sec(ts), "value": round(float(row["SMA_200"]), 4)}
        for ts, row in df.iterrows()
        if "SMA_200" in row and pd.notna(row.get("SMA_200"))
    ]

    markers_data = []
    if "Buy_Signal" in df.columns:
        buy = df.loc[df["Buy_Signal"] == 1]
        for ts in buy.index:
            markers_data.append({
                "time": _unix_sec(ts),
                "position": "belowBar",
                "color": "green",
                "shape": "arrowUp",
                "text": "BUY",
            })

    return {
        "candlestick_data": candlestick_data,
        "ema12_data": ema12_data,
        "ema26_data": ema26_data,
        "sma200_data": sma200_data,
        "markers_data": markers_data,
    }


@app.post("/api/circuit-breaker/reset")
async def reset_circuit_breaker(session: Dict = Depends(require_auth)):
    """Reset circuit breaker"""
    if not trader or not trader.circuit_breaker:
        raise HTTPException(status_code=400, detail="Circuit breaker not available")
    
    trader.circuit_breaker.reset(force=True)
    return {"success": True, "message": "Circuit breaker reset"}


# ===== HTML Templates =====

def generate_login_html() -> str:
    """Generate login page HTML with new design system"""
    return """
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - AT vol.2 Trading Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --color-bg-primary: #0f0f1a;
            --color-bg-secondary: #1a1a2e;
            --color-surface: rgba(30, 30, 46, 0.8);
            --color-surface-border: rgba(255, 255, 255, 0.08);
            --color-primary: #10b981;
            --color-primary-hover: #059669;
            --color-text-primary: #ffffff;
            --color-text-secondary: rgba(255, 255, 255, 0.7);
            --color-text-muted: rgba(255, 255, 255, 0.35);
            --radius-lg: 12px;
            --radius-md: 8px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, var(--color-bg-primary) 0%, var(--color-bg-secondary) 50%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--color-text-primary);
        }
        .login-container {
            background: var(--color-surface);
            backdrop-filter: blur(12px);
            padding: 2.5rem;
            border-radius: var(--radius-lg);
            border: 1px solid var(--color-surface-border);
            width: 100%;
            max-width: 400px;
            box-shadow: 0 20px 25px rgba(0, 0, 0, 0.6);
        }
        .logo { 
            text-align: center; 
            margin-bottom: 2rem;
        }
        .logo-icon { font-size: 3rem; margin-bottom: 0.5rem; }
        .logo-text { font-size: 1.5rem; font-weight: 700; }
        .logo-subtitle { font-size: 0.875rem; color: var(--color-text-secondary); margin-top: 0.25rem; }
        .form-group { margin-bottom: 1.25rem; }
        label { 
            display: block; 
            margin-bottom: 0.5rem; 
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--color-text-secondary);
        }
        input {
            width: 100%;
            padding: 0.875rem 1rem;
            border: 1px solid var(--color-surface-border);
            border-radius: var(--radius-md);
            background: var(--color-bg-secondary);
            color: var(--color-text-primary);
            font-size: 1rem;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        input:focus { 
            outline: none; 
            border-color: var(--color-primary);
            box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
        }
        input::placeholder { color: var(--color-text-muted); }
        button {
            width: 100%;
            padding: 0.875rem;
            background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover));
            color: var(--color-bg-primary);
            border: none;
            border-radius: var(--radius-md);
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            margin-top: 0.5rem;
            transition: box-shadow 0.2s, transform 0.2s;
        }
        button:hover { 
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
            transform: translateY(-1px);
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">
            <div class="logo-icon">📈</div>
            <div class="logo-text">AT vol.2</div>
            <div class="logo-subtitle">Trading Dashboard</div>
        </div>
        <form action="/login" method="post">
            <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username" placeholder="Enter username" required autocomplete="username">
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" placeholder="Enter password" required autocomplete="current-password">
            </div>
            <button type="submit">Sign In</button>
        </form>
    </div>
</body>
</html>
"""


def generate_dashboard_html() -> str:
    """Generate dashboard page HTML with new design system matching Django frontend"""
    return """
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AT vol.2 - Real-Time Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root {
            --color-bg-primary: #0f0f1a;
            --color-bg-secondary: #1a1a2e;
            --color-surface: rgba(30, 30, 46, 0.8);
            --color-surface-hover: rgba(40, 40, 60, 0.9);
            --color-surface-border: rgba(255, 255, 255, 0.08);
            --color-primary: #10b981;
            --color-primary-hover: #059669;
            --color-primary-light: rgba(16, 185, 129, 0.15);
            --color-danger: #ef4444;
            --color-danger-light: rgba(239, 68, 68, 0.15);
            --color-warning: #f59e0b;
            --color-text-primary: #ffffff;
            --color-text-secondary: rgba(255, 255, 255, 0.7);
            --color-text-muted: rgba(255, 255, 255, 0.35);
            --font-family-base: 'Inter', -apple-system, sans-serif;
            --font-family-mono: 'JetBrains Mono', monospace;
            --radius-lg: 12px;
            --radius-md: 8px;
            --space-2: 0.5rem;
            --space-3: 0.75rem;
            --space-4: 1rem;
            --space-5: 1.25rem;
            --space-6: 1.5rem;
            --sidebar-width: 260px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: var(--font-family-base);
            background: linear-gradient(135deg, var(--color-bg-primary) 0%, var(--color-bg-secondary) 50%, #16213e 100%);
            min-height: 100vh;
            color: var(--color-text-primary);
            display: flex;
        }
        
        /* Sidebar */
        .sidebar {
            width: var(--sidebar-width);
            background: var(--color-surface);
            backdrop-filter: blur(12px);
            border-right: 1px solid var(--color-surface-border);
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            display: flex;
            flex-direction: column;
            z-index: 100;
        }
        .sidebar-header {
            padding: var(--space-5);
            border-bottom: 1px solid var(--color-surface-border);
        }
        .sidebar-logo {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            text-decoration: none;
            color: var(--color-text-primary);
        }
        .sidebar-logo-icon { font-size: 1.5rem; }
        .sidebar-logo-text { font-size: 1.25rem; font-weight: 700; }
        .sidebar-nav { flex: 1; padding: var(--space-4) 0; }
        .nav-section-title {
            font-size: 0.7rem;
            font-weight: 600;
            color: var(--color-text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: var(--space-2) var(--space-5);
            margin-top: var(--space-4);
        }
        .nav-item {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            padding: var(--space-3) var(--space-5);
            color: var(--color-text-secondary);
            text-decoration: none;
            transition: all 0.2s;
        }
        .nav-item:hover { background: var(--color-surface-hover); color: var(--color-text-primary); }
        .nav-item.active { background: var(--color-primary-light); color: var(--color-primary); }
        .nav-item-icon { font-size: 1.1rem; width: 24px; text-align: center; }
        .sidebar-footer {
            padding: var(--space-4) var(--space-5);
            border-top: 1px solid var(--color-surface-border);
        }
        .connection-status {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            font-size: 0.875rem;
            color: var(--color-text-secondary);
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--color-primary);
            box-shadow: 0 0 8px var(--color-primary);
        }
        .status-dot.offline { background: var(--color-danger); box-shadow: 0 0 8px var(--color-danger); }
        
        /* Main content */
        .main-content {
            flex: 1;
            margin-left: var(--sidebar-width);
            min-height: 100vh;
        }
        .main-header {
            height: 64px;
            background: var(--color-surface);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid var(--color-surface-border);
            padding: 0 var(--space-6);
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: sticky;
            top: 0;
            z-index: 50;
        }
        .header-title { font-size: 1.125rem; font-weight: 600; }
        .header-right { display: flex; align-items: center; gap: var(--space-4); }
        .btn {
            display: inline-flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-2) var(--space-4);
            font-size: 0.875rem;
            font-weight: 500;
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
        }
        .btn-primary {
            background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover));
            color: var(--color-bg-primary);
            border: none;
        }
        .btn-primary:hover { box-shadow: 0 0 20px rgba(16, 185, 129, 0.4); }
        .btn-ghost {
            background: transparent;
            color: var(--color-text-secondary);
            border: 1px solid var(--color-surface-border);
        }
        .btn-ghost:hover { background: var(--color-surface-hover); color: var(--color-text-primary); }
        
        .content-area { padding: var(--space-6); }
        
        /* Grid */
        .grid { display: grid; gap: var(--space-6); }
        .grid-cols-4 { grid-template-columns: repeat(4, 1fr); }
        .grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
        @media (max-width: 1200px) { .grid-cols-4 { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 768px) { .grid-cols-4, .grid-cols-2 { grid-template-columns: 1fr; } }
        
        /* Cards */
        .card {
            background: var(--color-surface);
            backdrop-filter: blur(12px);
            border: 1px solid var(--color-surface-border);
            border-radius: var(--radius-lg);
            overflow: hidden;
        }
        .card-header {
            padding: var(--space-4) var(--space-5);
            border-bottom: 1px solid var(--color-surface-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .card-title {
            font-size: 0.875rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }
        .card-title-icon { color: var(--color-primary); }
        .card-body { padding: var(--space-5); }
        
        /* Stat cards */
        .stat-card { position: relative; }
        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--color-primary);
        }
        .stat-card.danger::before { background: var(--color-danger); }
        .stat-card.warning::before { background: var(--color-warning); }
        .stat-label {
            font-size: 0.75rem;
            color: var(--color-text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: var(--space-2);
        }
        .stat-value {
            font-size: 1.875rem;
            font-weight: 700;
            font-family: var(--font-family-mono);
        }
        .stat-value.positive { color: var(--color-primary); }
        .stat-value.negative { color: var(--color-danger); }
        .stat-subtitle {
            font-size: 0.875rem;
            color: var(--color-text-secondary);
            margin-top: var(--space-2);
        }
        
        /* Badges */
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 12px;
            font-size: 0.75rem;
            font-weight: 600;
            border-radius: 9999px;
            text-transform: uppercase;
        }
        .badge-success { background: var(--color-primary-light); color: var(--color-primary); }
        .badge-danger { background: var(--color-danger-light); color: var(--color-danger); }
        .badge-neutral { background: rgba(255,255,255,0.1); color: var(--color-text-secondary); }
        
        /* Tables */
        .table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
        .table th {
            background: rgba(0, 0, 0, 0.2);
            color: var(--color-text-secondary);
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.7rem;
            letter-spacing: 0.05em;
            padding: var(--space-3) var(--space-4);
            text-align: left;
        }
        .table td {
            padding: var(--space-3) var(--space-4);
            border-bottom: 1px solid var(--color-surface-border);
        }
        .table tbody tr:hover { background: var(--color-surface-hover); }
        .table .text-right { text-align: right; }
        .table .mono { font-family: var(--font-family-mono); }
        .text-success { color: var(--color-primary) !important; }
        .text-danger { color: var(--color-danger) !important; }
        
        /* Chart controls */
        .chart-controls {
            display: flex;
            gap: var(--space-3);
            flex-wrap: wrap;
            align-items: center;
        }
        .chart-controls label {
            font-size: 0.875rem;
            color: var(--color-text-secondary);
        }
        .form-select {
            padding: var(--space-2) var(--space-3);
            background: var(--color-bg-secondary);
            border: 1px solid var(--color-surface-border);
            border-radius: var(--radius-md);
            color: var(--color-text-primary);
            font-size: 0.875rem;
        }
        .form-select:focus { outline: none; border-color: var(--color-primary); }
        .chart-root { min-height: 400px; background: var(--color-bg-primary); border-radius: var(--radius-md); }
        .chart-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-3);
            padding: var(--space-6);
            color: var(--color-text-secondary);
        }
        .chart-error {
            padding: var(--space-4);
            background: var(--color-danger-light);
            color: var(--color-danger);
            border-radius: var(--radius-md);
            margin-bottom: var(--space-4);
        }
        
        /* Responsive */
        @media (max-width: 1024px) {
            .sidebar { transform: translateX(-100%); }
            .main-content { margin-left: 0; }
        }
    </style>
</head>
<body>
    <!-- Sidebar -->
    <aside class="sidebar">
        <div class="sidebar-header">
            <a href="/" class="sidebar-logo">
                <span class="sidebar-logo-icon">📈</span>
                <span class="sidebar-logo-text">AT vol.2</span>
            </a>
        </div>
        <nav class="sidebar-nav">
            <div class="nav-section-title">Overview</div>
            <a href="/" class="nav-item active">
                <span class="nav-item-icon">🏠</span>
                <span>Dashboard</span>
            </a>
            <div class="nav-section-title">System</div>
            <a href="/api/status" class="nav-item" target="_blank">
                <span class="nav-item-icon">📊</span>
                <span>API Status</span>
            </a>
            <a href="/api/positions" class="nav-item" target="_blank">
                <span class="nav-item-icon">💼</span>
                <span>Positions API</span>
            </a>
        </nav>
        <div class="sidebar-footer">
            <div class="connection-status" id="connection-status">
                <span class="status-dot" id="status-dot"></span>
                <span id="status-text">Connecting...</span>
            </div>
        </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content">
        <header class="main-header">
            <h1 class="header-title">Real-Time Dashboard</h1>
            <div class="header-right">
                <span id="last-update" style="font-size: 0.875rem; color: var(--color-text-muted);"></span>
                <button class="btn btn-primary" onclick="refreshData()">
                    <span>🔄</span> Refresh
                </button>
                <a href="/logout" class="btn btn-ghost">Logout</a>
            </div>
        </header>

        <div class="content-area">
            <!-- Stats Grid -->
            <div class="grid grid-cols-4" style="margin-bottom: var(--space-6);">
                <div class="card stat-card">
                    <div class="card-body">
                        <div class="stat-label">Total Balance</div>
                        <div class="stat-value" id="balance">Loading...</div>
                    </div>
                </div>
                <div class="card stat-card" id="pnl-card">
                    <div class="card-body">
                        <div class="stat-label">Today's P&L</div>
                        <div class="stat-value" id="pnl">Loading...</div>
                    </div>
                </div>
                <div class="card stat-card">
                    <div class="card-body">
                        <div class="stat-label">Market Status</div>
                        <div id="market-status">Loading...</div>
                    </div>
                </div>
                <div class="card stat-card">
                    <div class="card-body">
                        <div class="stat-label">Circuit Breaker</div>
                        <div id="circuit-breaker">Loading...</div>
                    </div>
                </div>
            </div>

            <!-- Positions Table -->
            <div class="card" style="margin-bottom: var(--space-6);">
                <div class="card-header">
                    <h3 class="card-title">
                        <span class="card-title-icon">💼</span>
                        Current Positions
                    </h3>
                </div>
                <div class="card-body" style="padding: 0;">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Symbol</th>
                                <th class="text-right">Quantity</th>
                                <th class="text-right">Avg Price</th>
                                <th class="text-right">Current</th>
                                <th class="text-right">P&L</th>
                                <th class="text-right">%</th>
                            </tr>
                        </thead>
                        <tbody id="positions-table">
                            <tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Chart -->
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">
                        <span class="card-title-icon">📊</span>
                        Price Chart
                    </h3>
                    <div class="chart-controls">
                        <label>Symbol</label>
                        <select id="chart-symbol" class="form-select" style="min-width: 100px;"></select>
                        <label>Period</label>
                        <select id="chart-period" class="form-select">
                            <option value="1y">1 Year</option>
                            <option value="6mo">6 Months</option>
                            <option value="3mo">3 Months</option>
                            <option value="1mo">1 Month</option>
                        </select>
                        <button type="button" id="chart-load" class="btn btn-primary">Load Chart</button>
                    </div>
                </div>
                <div class="card-body">
                    <div id="chart-loading" class="chart-loading" style="display: none;">
                        <span>Loading chart...</span>
                    </div>
                    <div id="chart-error" class="chart-error" style="display: none;"></div>
                    <div id="chart-root" class="chart-root"></div>
                </div>
            </div>
        </div>
    </main>

    <script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
    <script>
        let dChart = null, dCandle = null, dEma12 = null, dEma26 = null, dSma200 = null;
        window.chartDataLoaded = false;

        function updateConnectionStatus(connected) {
            const dot = document.getElementById('status-dot');
            const text = document.getElementById('status-text');
            if (connected) {
                dot.classList.remove('offline');
                text.textContent = 'Live';
            } else {
                dot.classList.add('offline');
                text.textContent = 'Disconnected';
            }
        }

        function ensureChart() {
            if (dChart) return;
            const root = document.getElementById('chart-root');
            if (!root) return;
            root.innerHTML = '';
            dChart = LightweightCharts.createChart(root, {
                layout: { background: { type: 'solid', color: '#0f0f1a' }, textColor: 'rgba(255,255,255,0.7)' },
                grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
                width: Math.max(root.clientWidth || 0, 600), height: 400,
                rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
                timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true, secondsVisible: false },
                crosshair: { vertLine: { color: 'rgba(99,102,241,0.4)' }, horzLine: { color: 'rgba(99,102,241,0.4)' } },
            });
            dCandle = dChart.addCandlestickSeries({ upColor: '#10b981', downColor: '#ef4444', borderDownColor: '#ef4444', borderUpColor: '#10b981', wickUpColor: '#10b981', wickDownColor: '#ef4444' });
            dEma12 = dChart.addLineSeries({ color: '#fbbf24', lineWidth: 1 });
            dEma26 = dChart.addLineSeries({ color: '#f97316', lineWidth: 1 });
            dSma200 = dChart.addLineSeries({ color: '#3b82f6', lineWidth: 2 });
            if (window.ResizeObserver) new ResizeObserver(() => { if (dChart && root) dChart.applyOptions({ width: root.clientWidth }); }).observe(root);
        }

        async function loadChart(sym, period, interval) {
            sym = (sym || 'AAPL').trim().toUpperCase();
            period = period || '1y';
            interval = interval || '1d';
            const loading = document.getElementById('chart-loading');
            const err = document.getElementById('chart-error');
            const root = document.getElementById('chart-root');
            
            if (loading) loading.style.display = 'flex';
            if (err) { err.textContent = ''; err.style.display = 'none'; }
            if (root) root.style.display = 'none';
            
            try {
                const res = await fetch('/api/chart-data?symbol=' + encodeURIComponent(sym) + '&period=' + encodeURIComponent(period) + '&interval=' + encodeURIComponent(interval));
                const data = res.ok ? await res.json() : {};
                if (!res.ok) { if (err) { err.textContent = (data.detail || res.statusText || 'Request failed'); err.style.display = 'block'; } return; }
                if (data.error) { if (err) { err.textContent = data.error; err.style.display = 'block'; } return; }
                ensureChart();
                dCandle.setData(data.candlestick_data || []);
                dEma12.setData(data.ema12_data || []);
                dEma26.setData(data.ema26_data || []);
                dSma200.setData(data.sma200_data || []);
                dCandle.setMarkers(data.markers_data || []);
                dChart.timeScale().fitContent();
                if (root) root.style.display = 'block';
                window.chartDataLoaded = true;
            } catch (e) { if (err) { err.textContent = 'Failed to load chart: ' + (e.message || 'Unknown'); err.style.display = 'block'; } }
            if (loading) loading.style.display = 'none';
        }

        async function refreshData() {
            try {
                const [status, pnl, positions] = await Promise.all([
                    fetch('/api/status').then(r => r.json()),
                    fetch('/api/pnl').then(r => r.json()),
                    fetch('/api/positions').then(r => r.json())
                ]);
                
                updateConnectionStatus(true);
                document.getElementById('last-update').textContent = 'Updated ' + new Date().toLocaleTimeString();
                
                // Balance
                if (status.balance) {
                    document.getElementById('balance').textContent = 
                        '₩' + new Intl.NumberFormat('ko-KR').format(status.balance.total_balance_krw || 0);
                }
                
                // P&L
                const totalPnl = (pnl.realized_pnl_krw || 0) + (pnl.unrealized_pnl_krw || 0);
                const pnlEl = document.getElementById('pnl');
                const pnlCard = document.getElementById('pnl-card');
                pnlEl.textContent = (totalPnl >= 0 ? '+' : '') + '₩' + new Intl.NumberFormat('ko-KR').format(Math.abs(totalPnl));
                pnlEl.className = 'stat-value ' + (totalPnl >= 0 ? 'positive' : 'negative');
                pnlCard.classList.toggle('danger', totalPnl < 0);
                
                // Market status
                if (status.market_status) {
                    const isOpen = status.market_status.can_trade;
                    document.getElementById('market-status').innerHTML = 
                        '<span class="badge ' + (isOpen ? 'badge-success' : 'badge-neutral') + '">' +
                        (isOpen ? 'OPEN' : 'CLOSED') + '</span>' +
                        '<div class="stat-subtitle">' + (status.market_status.message || '') + '</div>';
                }
                
                // Circuit breaker
                if (status.circuit_breaker) {
                    const canTrade = status.circuit_breaker.can_trade;
                    document.getElementById('circuit-breaker').innerHTML = 
                        '<span class="badge ' + (canTrade ? 'badge-success' : 'badge-danger') + '">' +
                        (canTrade ? 'OK' : 'TRIPPED') + '</span>' +
                        '<div class="stat-subtitle">Losses: ' + 
                        (status.circuit_breaker.consecutive_losses || 0) + '/' + 
                        (status.circuit_breaker.max_consecutive_losses || 3) + '</div>';
                }
                
                // Positions
                const tbody = document.getElementById('positions-table');
                if (positions.positions && positions.positions.length > 0) {
                    tbody.innerHTML = positions.positions.map(p => `
                        <tr>
                            <td><strong>${p.symbol}</strong></td>
                            <td class="text-right mono">${p.quantity}</td>
                            <td class="text-right mono">$${p.avg_price.toFixed(2)}</td>
                            <td class="text-right mono">$${p.current_price.toFixed(2)}</td>
                            <td class="text-right mono ${p.unrealized_pnl >= 0 ? 'text-success' : 'text-danger'}">
                                ${p.unrealized_pnl >= 0 ? '+' : ''}$${p.unrealized_pnl.toFixed(2)}
                            </td>
                            <td class="text-right mono ${p.unrealized_pnl_percent >= 0 ? 'text-success' : 'text-danger'}">
                                ${p.unrealized_pnl_percent >= 0 ? '+' : ''}${p.unrealized_pnl_percent.toFixed(1)}%
                            </td>
                        </tr>
                    `).join('');
                } else {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No open positions</td></tr>';
                }

                // Chart symbol select
                const sel = document.getElementById('chart-symbol');
                if (sel) {
                    let syms = (positions.positions || []).map(p => p.symbol).filter(Boolean);
                    if (!syms.length) syms = ['AAPL'];
                    sel.innerHTML = syms.map(s => '<option value="' + s + '">' + s + '</option>').join('');
                    sel.value = syms[0];
                    if ((positions.positions || []).length && !window.chartDataLoaded) {
                        loadChart(positions.positions[0].symbol, document.getElementById('chart-period').value || '1y', '1d');
                    }
                }
            } catch (error) {
                console.error('Error refreshing data:', error);
                updateConnectionStatus(false);
            }
        }

        document.getElementById('chart-load').addEventListener('click', function() {
            loadChart(document.getElementById('chart-symbol').value, document.getElementById('chart-period').value || '1y', '1d');
        });
        
        // Initial load
        refreshData();
        
        // Auto-refresh every 10 seconds
        setInterval(refreshData, 10000);
    </script>
</body>
</html>
"""


def run_dashboard(host: str = "127.0.0.1", port: int = 8000):
    """Run the dashboard server"""
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    run_dashboard()


