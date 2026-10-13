CREATE TABLE IF NOT EXISTS pageview_demo_daily (
  day TEXT NOT NULL,
  country TEXT NOT NULL CHECK (length(country) = 2),
  operating_system TEXT NOT NULL CHECK (operating_system IN ('Android', 'iOS', 'Windows', 'macOS', 'Linux', 'Khác')),
  page TEXT NOT NULL CHECK (page = 'home'),
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (day, country, operating_system, page)
);

CREATE INDEX IF NOT EXISTS idx_pageview_demo_daily_day ON pageview_demo_daily(day);
