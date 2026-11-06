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
  status TEXT DEFAULT 'completed',        -- 'charging' | 'completed'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_charges_date ON charges(date);
CREATE INDEX IF NOT EXISTS idx_charges_status ON charges(status);
