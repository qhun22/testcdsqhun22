PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price >= 0),
  image_url TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email, phone)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'shipping', 'completed', 'cancelled')),
  payment_method TEXT NOT NULL,
  total INTEGER NOT NULL CHECK (total >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

INSERT OR IGNORE INTO categories (id, name, slug) VALUES
  (1, 'Đồ khô', 'do-kho'),
  (2, 'Rau củ', 'rau-cu'),
  (3, 'Đồ uống', 'do-uong'),
  (4, 'Đồ dùng nhà bếp', 'nha-bep');

INSERT OR IGNORE INTO products (id, category_id, name, description, price, image_url, stock, featured) VALUES
  (1, 1, 'Hạt điều rang muối', 'Hạt điều Bình Phước, rang mẻ nhỏ, vị bùi thơm.', 89000, 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?auto=format&fit=crop&w=900&q=85', 28, 1),
  (2, 2, 'Cà chua vườn', 'Cà chua chín tự nhiên, thu hoạch trong ngày.', 32000, 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=900&q=85', 35, 1),
  (3, 3, 'Trà ô long túi lọc', 'Hương trà dịu nhẹ, hộp 20 túi lọc tiện dụng.', 68000, 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=85', 19, 1),
  (4, 4, 'Túi vải đi chợ', 'Túi cotton tái sử dụng, gọn nhẹ và bền chắc.', 45000, 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=85', 42, 0),
  (5, 1, 'Mật ong hoa cà phê', 'Mật ong nguyên chất, chai thủy tinh 500 ml.', 145000, 'https://images.unsplash.com/photo-1587049352851-8d4e89133924?auto=format&fit=crop&w=900&q=85', 12, 0),
  (6, 2, 'Bí đỏ hữu cơ', 'Bí đỏ canh tác theo mùa, vị ngọt bùi tự nhiên.', 38000, 'https://images.unsplash.com/photo-1570586437263-ab629fccc818?auto=format&fit=crop&w=900&q=85', 22, 0);