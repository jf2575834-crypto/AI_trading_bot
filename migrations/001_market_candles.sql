-- KAN-6 proposed schema; integrate with shared migrations after database-owner review.
BEGIN;

CREATE TABLE market_candles (
	provider VARCHAR(32) NOT NULL,
	feed VARCHAR(32) NOT NULL,
	adjustment VARCHAR(32) NOT NULL,
	currency VARCHAR(32) NOT NULL,
	symbol VARCHAR(32) NOT NULL,
	timeframe VARCHAR(32) NOT NULL,
	timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
	open NUMERIC(28, 10) NOT NULL,
	high NUMERIC(28, 10) NOT NULL,
	low NUMERIC(28, 10) NOT NULL,
	close NUMERIC(28, 10) NOT NULL,
	volume NUMERIC(28, 10) NOT NULL,
	ingested_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (provider, feed, adjustment, currency, symbol, timeframe, timestamp),
	CONSTRAINT ck_market_candles_ohlcv CHECK (low >= 0 AND high >= low AND open >= low AND open <= high AND close >= low AND close <= high AND volume >= 0)
);

CREATE INDEX ix_market_candles_symbol_time ON market_candles (symbol, timeframe, timestamp);

COMMIT;
