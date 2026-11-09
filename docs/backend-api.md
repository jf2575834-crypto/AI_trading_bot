# TradeMind Backend API — GUI Integration Guide

## Overview

The TradeMind backend uses FastAPI to connect the GUI with historical market data and, eventually, the CPU trading algorithm and FPGA.

**Local backend:** `http://localhost:8000`

**Interactive API documentation:** `http://localhost:8000/docs`

## Available Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Check backend availability |
| GET | `/api/v1/assets` | Retrieve supported assets (AAPL and MSFT) |
| GET | `/api/v1/strategies` | Retrieve available strategies (placeholder) |
| GET | `/api/v1/market-data` | Retrieve historical data from Alpaca |
| GET | `/api/v1/datasets/AAPL` | Retrieve local AAPL historical data |
| GET | `/api/v1/datasets/MSFT` | Retrieve local MSFT historical data |
| POST | `/api/v1/trading/run` | Submit a trading execution request (not yet implemented) |


## Historical Market Data

Example:

`GET /api/v1/market-data?symbol=AAPL&timeframe=1Day&limit=100`

This endpoint requires working Alpaca credentials.

For the offline prototype, use:

`GET /api/v1/datasets/AAPL`

The offline endpoint returns historical candles, dataset metadata, and a SHA-256 checksum. The corresponding local dataset file must exist on the backend machine.

## Trading Execution Request

**Endpoint:** `POST /api/v1/trading/run`

Example request:

```json
{
  "symbol": "AAPL",
  "strategy": "moving_average_crossover",
  "parameters": {
    "short_window": 20,
    "long_window": 50
  },
  "execution_mode": "cpu"
}
```

Supported request values:

- `symbol`: `AAPL` or `MSFT`
- `strategy`: `moving_average_crossover`
- `execution_mode`: `cpu` or `fpga`
- `short_window`: Positive integer smaller than `long_window`
- `long_window`: Integer of at least 2

## Current Trading Endpoint Behavior

The trading endpoint validates requests but **does not execute a strategy yet**.

- HTTP `422`: Invalid request.
- HTTP `501`: Valid request, but trading execution is not yet implemented.

The GUI should not display a trading signal or benchmark result when the backend returns HTTP 501.

## Planned Trading Response

The following response is a proposed interface, not currently implemented:

```json
{
  "symbol": "AAPL",
  "strategy": "moving_average_crossover",
  "requested_mode": "cpu",
  "actual_mode": "cpu",
  "signal": "BUY",
  "indicators": {
    "short_ma": 250.12,
    "long_ma": 247.85
  },
  "execution_time_ms": 1.42,
  "fallback_used": false
}
```

All values above are illustrative.

The final response contract must be agreed upon with Xa-Quan, Alejandro, and Moshope.

## Frontend Connection

The backend currently allows cross-origin requests from:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

The frontend should use the backend base URL `http://localhost:8000` during local development.

## Remaining Integration Work

- Connect Xa-Quan's CPU moving-average algorithm.
- Connect Alejandro's FPGA interface.
- Implement CPU fallback when FPGA execution is unavailable.
- Return real signals, indicators, and benchmark measurements.
- Test the complete GUI-to-backend workflow.