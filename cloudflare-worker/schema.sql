-- Cloudflare D1 Database Schema for MG Windsor EV Telematics
-- To deploy:
-- 1. Create database: wrangler d1 create mg-windsor-db
-- 2. Execute schema:  wrangler d1 execute mg-windsor-db --file=./schema.sql

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,                     -- IST date 'YYYY-MM-DD'
  start_timestamp INTEGER NOT NULL,       -- Unix timestamp in seconds
  end_timestamp INTEGER,
  duration_seconds INTEGER,
  distance_km REAL,                       -- Odometer delta
  start_odometer_km REAL,
  end_odometer_km REAL,
  start_soc INTEGER,                      -- Battery percentage (0-100)
  end_soc INTEGER,
  energy_used_kwh REAL,                   -- Estimated energy consumed
  efficiency_km_per_kwh REAL,             -- Distance / Energy
  start_location TEXT,                    -- Resolved starting address / city
  end_location TEXT,                      -- Resolved destination address / city
  avg_speed_kmh REAL,
  max_speed_kmh REAL,
  status TEXT DEFAULT 'completed',        -- 'ongoing' | 'completed'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(date);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);

CREATE TABLE IF NOT EXISTS charges (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,                     -- IST date 'YYYY-MM-DD'
  start_timestamp INTEGER NOT NULL,       -- Unix timestamp in seconds
  end_timestamp INTEGER,
  duration_seconds INTEGER,
  start_soc INTEGER,                      -- Battery percentage (0-100)
  end_soc INTEGER,
  energy_added_kwh REAL,                  -- Estimated kWh added to pack
  charger_type TEXT,                      -- 'AC 3.3 kW', 'AC 7.4 kW', 'DC Fast'
  peak_kw REAL,
  odometer_km REAL,
  end_range_km REAL,
  lat REAL,
  lng REAL,
  location TEXT,
  status TEXT DEFAULT 'completed',        -- 'charging' | 'completed'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_charges_date ON charges(date);
CREATE INDEX IF NOT EXISTS idx_charges_status ON charges(status);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                     -- 'trip_start' | 'trip_stop' | 'trip_idle' | 'charge_start' | 'charge_stop'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL,             -- Unix timestamp in seconds
  date TEXT NOT NULL,                     -- IST date 'YYYY-MM-DD'
  metadata TEXT,                          -- JSON string with extra details
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_date ON notifications(date);

-- One-Time Access Codes for friends & authorized users
CREATE TABLE IF NOT EXISTS access_codes (
  code TEXT PRIMARY KEY,
  assigned_name TEXT,
  assigned_phone TEXT,
  notes TEXT,
  status TEXT DEFAULT 'active',           -- 'active' | 'used' | 'revoked'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at INTEGER,                     -- Unix timestamp (seconds), null = no expiration
  redeemed_at TEXT,
  redeemed_by_phone TEXT,
  redeemed_by_vin TEXT,
  redeemed_device_info TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_codes_status ON access_codes(status);
CREATE INDEX IF NOT EXISTS idx_access_codes_phone ON access_codes(assigned_phone);

-- Authorized Users / Friends List
CREATE TABLE IF NOT EXISTS authorized_users (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'active',           -- 'active' | 'blocked'
  access_code TEXT,
  vin TEXT,
  car_name TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_authorized_users_phone ON authorized_users(phone);

-- Security Audit Logs
CREATE TABLE IF NOT EXISTS access_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,                   -- 'code_generated' | 'code_redeemed' | 'code_revoked' | 'login_success' | 'login_blocked' | 'user_blocked' | 'user_unblocked'
  phone TEXT,
  code TEXT,
  status TEXT NOT NULL,                   -- 'success' | 'blocked' | 'revoked'
  reason TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at DESC);
