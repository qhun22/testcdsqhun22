"""
Basin Catalog setup — Nhom 4 Chuyen Doi So
Tao Iceberg table 'user_events' va ghi sample data vao Basin Catalog
Chay: python -I scripts/basin_catalog_setup.py
"""
import sys
import uuid
import os
from datetime import datetime, timezone, timedelta
import random

CF_ACCOUNT_ID = "c0569221e44f432f6669b8df70446872"
CF_BUCKET      = "cho-nha-data-lake"
CF_TOKEN       = os.environ.get("CF_CATALOG_TOKEN")
R2_ACCESS_KEY  = os.environ.get("CF_R2_ACCESS_KEY_ID")
R2_SECRET_KEY  = os.environ.get("CF_R2_SECRET_ACCESS_KEY")

CATALOG_URI  = f"https://catalog.cloudflarestorage.com/{CF_ACCOUNT_ID}/{CF_BUCKET}"
WAREHOUSE    = f"{CF_ACCOUNT_ID}_{CF_BUCKET}"
R2_ENDPOINT  = f"https://{CF_ACCOUNT_ID}.r2.cloudflarestorage.com"
NAMESPACE    = "cho_nha"
TABLE_NAME   = "user_events"

missing = [
    name for name, value in (
        ("CF_CATALOG_TOKEN", CF_TOKEN),
        ("CF_R2_ACCESS_KEY_ID", R2_ACCESS_KEY),
        ("CF_R2_SECRET_ACCESS_KEY", R2_SECRET_KEY),
    ) if not value
]
if missing:
    print("Thieu bien moi truong: " + ", ".join(missing))
    sys.exit(1)

try:
    from pyiceberg.catalog import load_catalog
    import pyarrow as pa
except ImportError:
    print("Cai dat: pip install 'pyiceberg[pyarrow]'")
    sys.exit(1)

# ── 1. Ket noi catalog ──────────────────────────────────────────────────────
print(f"[1/4] Ket noi Basin Catalog: {CATALOG_URI}")
catalog = load_catalog(
    "cloudflare",
    **{
        "type": "rest",
        "uri": CATALOG_URI,
        "warehouse": WAREHOUSE,
        "token": CF_TOKEN,
        "s3.signer": "S3V4RestSigner",
        "s3.signer.uri": "https://catalog.cloudflarestorage.com/catalog/v1/851167aa-cbbb-11f1-8000-53f8be4a60d6",
        "s3.region": "auto",
        "s3.endpoint": R2_ENDPOINT,
    },
)
print("      OK - catalog loaded")

# ── 2. Tao namespace ────────────────────────────────────────────────────────
print(f"[2/4] Tao namespace '{NAMESPACE}'")
try:
    catalog.create_namespace(NAMESPACE)
    print("      namespace created")
except Exception as e:
    if "already exists" in str(e).lower() or "AlreadyExistsException" in str(type(e)):
        print("      namespace da ton tai, bo qua")
    else:
        raise

# ── 3. Tao hoac load table ──────────────────────────────────────────────────
TABLE_IDENT = f"{NAMESPACE}.{TABLE_NAME}"
print(f"[3/4] Tao table '{TABLE_IDENT}'")

schema = pa.schema([
    pa.field("event_id",          pa.string(),  nullable=False),
    pa.field("event_type",        pa.string(),  nullable=False),
    pa.field("ts",                pa.string(),  nullable=False),
    pa.field("country",           pa.string(),  nullable=True),
    pa.field("operating_system",  pa.string(),  nullable=True),
    pa.field("page",              pa.string(),  nullable=True),
    pa.field("session_id",        pa.string(),  nullable=True),
    pa.field("product_id",        pa.string(),  nullable=True),
    pa.field("product_name",      pa.string(),  nullable=True),
    pa.field("action",            pa.string(),  nullable=True),
    pa.field("message_preview",   pa.string(),  nullable=True),
    pa.field("message_len",       pa.int32(),   nullable=True),
    pa.field("has_product_result",pa.bool_(),   nullable=True),
    pa.field("group_label",       pa.string(),  nullable=True),
])

from pyiceberg.schema import Schema
from pyiceberg.types import (
    NestedField, StringType, IntegerType, BooleanType
)
iceberg_schema = Schema(
    NestedField(1,  "event_id",           StringType(),  required=True),
    NestedField(2,  "event_type",         StringType(),  required=True),
    NestedField(3,  "ts",                 StringType(),  required=True),
    NestedField(4,  "country",            StringType(),  required=False),
    NestedField(5,  "operating_system",   StringType(),  required=False),
    NestedField(6,  "page",               StringType(),  required=False),
    NestedField(7,  "session_id",         StringType(),  required=False),
    NestedField(8,  "product_id",         StringType(),  required=False),
    NestedField(9,  "product_name",       StringType(),  required=False),
    NestedField(10, "action",             StringType(),  required=False),
    NestedField(11, "message_preview",    StringType(),  required=False),
    NestedField(12, "message_len",        IntegerType(), required=False),
    NestedField(13, "has_product_result", BooleanType(), required=False),
    NestedField(14, "group_label",        StringType(),  required=False),
)

try:
    tbl = catalog.create_table(TABLE_IDENT, schema=iceberg_schema)
    print("      table created")
except Exception as e:
    if "already exists" in str(e).lower() or "AlreadyExistsException" in str(type(e)):
        print("      table da ton tai, load lai")
        tbl = catalog.load_table(TABLE_IDENT)
    else:
        raise

# ── 4. Sinh du lieu mau Nhom 4 ─────────────────────────────────────────────
print("[4/4] Ghi du lieu mau vao Basin Catalog...")

def ts(hours_ago=0, minutes_ago=0):
    t = datetime.now(timezone.utc) - timedelta(hours=hours_ago, minutes=minutes_ago)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")

COUNTRIES = ["VN", "VN", "VN", "VN", "US", "SG", "JP", "KR"]
OS_LIST   = ["iOS", "Android", "PC", "PC", "iOS", "Android"]
PRODUCTS  = [
    ("P001", "Rau muong tuoi"),
    ("P002", "Ca chua bi do"),
    ("P003", "Hat dieu rang muoi"),
    ("P004", "Mat ong nguyen chat"),
    ("P005", "Dau an thuc vat"),
    ("P006", "Nuoc mam nhi"),
]

rows = []

def row(**kw):
    return {
        "event_id":           str(uuid.uuid4()),
        "group_label":        "Nhom4-ChuyenDoiSo",
        "country":            random.choice(COUNTRIES),
        "operating_system":   random.choice(OS_LIST),
        "page":               None,
        "session_id":         None,
        "product_id":         None,
        "product_name":       None,
        "action":             None,
        "message_preview":    None,
        "message_len":        None,
        "has_product_result": None,
        **kw,
    }

# page_view events
for i in range(18):
    rows.append(row(
        event_type="page_view",
        ts=ts(hours_ago=random.randint(0, 23), minutes_ago=random.randint(0, 59)),
        page="home",
    ))

# chatbot_message events
chatbot_msgs = [
    ("Nhom4: co rau cu gi khong ban",       True,  28),
    ("Nhom4: gia hat dieu bao nhieu vay",   True,  30),
    ("Nhom4: thanh toan VietQR nhu the nao",False, 35),
    ("Nhom4: phi giao hang bao nhieu",      False, 26),
    ("Nhom4: co mat ong khong",             True,  22),
    ("Nhom4: dat hang duoc khong",          False, 24),
    ("Nhom4: giao hang nhanh khong",        False, 28),
    ("Nhom4: ca chua bao nhieu 1kg",        True,  25),
]
sessions = ["Nhom4-ses-1", "Nhom4-ses-2", "Nhom4-ses-3"]
for i, (msg, has_prod, mlen) in enumerate(chatbot_msgs):
    rows.append(row(
        event_type="chatbot_message",
        ts=ts(hours_ago=random.randint(0, 12), minutes_ago=random.randint(0, 59)),
        session_id=random.choice(sessions),
        message_preview=msg,
        message_len=mlen,
        has_product_result=has_prod,
    ))

# view_product events
for i in range(12):
    pid, pname = random.choice(PRODUCTS)
    rows.append(row(
        event_type="view_product",
        ts=ts(hours_ago=random.randint(0, 23), minutes_ago=random.randint(0, 59)),
        session_id=f"Nhom4-ses-{random.randint(1,5)}",
        product_id=pid,
        product_name=pname,
        action="view",
    ))

# add_to_cart events
for i in range(9):
    pid, pname = random.choice(PRODUCTS)
    rows.append(row(
        event_type="add_to_cart",
        ts=ts(hours_ago=random.randint(0, 20), minutes_ago=random.randint(0, 59)),
        session_id=f"Nhom4-ses-{random.randint(1,5)}",
        product_id=pid,
        product_name=pname,
        action="add_to_cart",
    ))

# abandon_cart (them hang nhung khong checkout) — 5 phien bo gio
for i in range(5):
    pid, pname = random.choice(PRODUCTS)
    rows.append(row(
        event_type="abandon_cart",
        ts=ts(hours_ago=random.randint(1, 18), minutes_ago=random.randint(0, 59)),
        session_id=f"Nhom4-abandon-{i+1}",
        product_id=pid,
        product_name=pname,
        action="abandon_cart",
    ))

# checkout_start events
for i in range(4):
    rows.append(row(
        event_type="checkout_start",
        ts=ts(hours_ago=random.randint(0, 15), minutes_ago=random.randint(0, 59)),
        session_id=f"Nhom4-ses-{random.randint(1,5)}",
        action="checkout_start",
    ))

# checkout_complete (thanh toan VietQR xong)
for i in range(3):
    rows.append(row(
        event_type="checkout_complete",
        ts=ts(hours_ago=random.randint(0, 12), minutes_ago=random.randint(0, 59)),
        session_id=f"Nhom4-ses-{random.randint(1,3)}",
        action="checkout_complete",
    ))

print(f"      Tong so ban ghi: {len(rows)}")

# Chuyen sang PyArrow Table
arrow_table = pa.table({
    "event_id":           pa.array([r["event_id"]           for r in rows], type=pa.string()),
    "event_type":         pa.array([r["event_type"]         for r in rows], type=pa.string()),
    "ts":                 pa.array([r["ts"]                 for r in rows], type=pa.string()),
    "country":            pa.array([r["country"]            for r in rows], type=pa.string()),
    "operating_system":   pa.array([r["operating_system"]   for r in rows], type=pa.string()),
    "page":               pa.array([r["page"]               for r in rows], type=pa.string()),
    "session_id":         pa.array([r["session_id"]         for r in rows], type=pa.string()),
    "product_id":         pa.array([r["product_id"]         for r in rows], type=pa.string()),
    "product_name":       pa.array([r["product_name"]       for r in rows], type=pa.string()),
    "action":             pa.array([r["action"]             for r in rows], type=pa.string()),
    "message_preview":    pa.array([r["message_preview"]    for r in rows], type=pa.string()),
    "message_len":        pa.array([r["message_len"]        for r in rows], type=pa.int32()),
    "has_product_result": pa.array([r["has_product_result"] for r in rows], type=pa.bool_()),
    "group_label":        pa.array([r["group_label"]        for r in rows], type=pa.string()),
})

tbl.append(arrow_table)
print(f"      Ghi thanh cong {len(rows)} ban ghi vao Basin Catalog!")
print()
print("=== DONE ===")
print(f"Catalog URI : {CATALOG_URI}")
print(f"Table       : {TABLE_IDENT}")
print(f"Records     : {len(rows)}")
print("Kiem tra tai: Cloudflare Dashboard -> R2 -> cho-nha-data-lake -> Basin Catalog -> Query data")
