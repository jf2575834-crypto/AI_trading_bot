-- Account tables for sign-up and login; integrate with shared migrations after database-owner review.
BEGIN;

CREATE TABLE users (
	id VARCHAR(36) PRIMARY KEY,
	email VARCHAR(254) NOT NULL UNIQUE,
	password_hash VARCHAR(255) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE sessions (
	token_hash VARCHAR(64) PRIMARY KEY,
	user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX ix_sessions_user_id ON sessions (user_id);

COMMIT;
