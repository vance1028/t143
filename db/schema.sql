-- 城市智慧停车运营管理平台 表结构（全程 utf8mb4，确保中文正常）
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  username      VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(64) NOT NULL,
  role          VARCHAR(16) NOT NULL DEFAULT 'VIEWER',
  status        VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_lots (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code          VARCHAR(32) NOT NULL UNIQUE,
  name          VARCHAR(128) NOT NULL,
  district      VARCHAR(64) NOT NULL,
  address       VARCHAR(255) NOT NULL DEFAULT '',
  total_spaces  INT NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_spaces (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lot_id      INT UNSIGNED NOT NULL,
  code        VARCHAR(32) NOT NULL,
  type        VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
  status      VARCHAR(16) NOT NULL DEFAULT 'FREE',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_lot_space (lot_id, code),
  CONSTRAINT fk_space_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicles (
  id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  plate_no     VARCHAR(16) NOT NULL UNIQUE,
  owner_name   VARCHAR(64) NOT NULL DEFAULT '',
  phone        VARCHAR(32) NOT NULL DEFAULT '',
  vehicle_type VARCHAR(16) NOT NULL DEFAULT 'SMALL',
  is_member    TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_sessions (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lot_id      INT UNSIGNED NOT NULL,
  space_id    INT UNSIGNED NULL,
  plate_no    VARCHAR(16) NOT NULL,
  enter_time  DATETIME(3) NOT NULL,
  exit_time   DATETIME(3) NULL,
  fee_cents   INT NOT NULL DEFAULT 0,
  status      VARCHAR(16) NOT NULL DEFAULT 'PARKED',
  paid        TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_session_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_space FOREIGN KEY (space_id) REFERENCES parking_spaces(id) ON DELETE SET NULL,
  INDEX idx_session_status (status),
  INDEX idx_session_plate (plate_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_plans (
  id                   INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name                 VARCHAR(128) NOT NULL,
  vehicle_type         VARCHAR(16) NOT NULL DEFAULT 'SMALL',
  is_holiday           TINYINT(1) NOT NULL DEFAULT 0,
  free_minutes         INT NOT NULL DEFAULT 0,
  daily_cap_cents      INT NOT NULL DEFAULT 0,
  member_discount_pct  INT NOT NULL DEFAULT 0,
  first_segment_free   TINYINT(1) NOT NULL DEFAULT 0,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_segments (
  id                    INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  plan_id               INT UNSIGNED NOT NULL,
  start_time            VARCHAR(5) NOT NULL,
  end_time              VARCHAR(5) NOT NULL,
  unit_price_cents      INT NOT NULL DEFAULT 0,
  granularity_minutes   INT NOT NULL DEFAULT 60,
  min_duration_minutes  INT NOT NULL DEFAULT 0,
  sort_order            INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_segment_plan FOREIGN KEY (plan_id) REFERENCES rate_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lot_rate_bindings (
  id         INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lot_id     INT UNSIGNED NOT NULL,
  plan_id    INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_lot_plan (lot_id, plan_id),
  CONSTRAINT fk_binding_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE,
  CONSTRAINT fk_binding_plan FOREIGN KEY (plan_id) REFERENCES rate_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS holiday_calendar (
  id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  holiday_date DATE NOT NULL UNIQUE,
  name         VARCHAR(128) NOT NULL DEFAULT '',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_snapshots (
  id               INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  session_id       INT UNSIGNED NOT NULL,
  plan_id          INT UNSIGNED NULL,
  snapshot_json    JSON NOT NULL,
  calculated_cents INT NOT NULL DEFAULT 0,
  detail_json      JSON NOT NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_snapshot_session (session_id),
  CONSTRAINT fk_snapshot_session FOREIGN KEY (session_id) REFERENCES parking_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_snapshot_plan FOREIGN KEY (plan_id) REFERENCES rate_plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
