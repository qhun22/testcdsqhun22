import os
import time

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
BUCKET = os.getenv("R2_BUCKET", "")
ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
USE_SAMPLE = os.getenv("USE_SAMPLE", "1") == "1"
R2_ENDPOINT = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"


def sample_events() -> pd.DataFrame:
    now_ms = int(time.time() * 1000)
    rows = [
        {"id": "01", "country": "VN", "device": "ios", "time": now_ms - i * 60_000, "ip": f"10.0.0.{i % 7}"}
        for i in range(40)
    ] + [
        {"id": "01", "country": "US", "device": "pc", "time": now_ms - i * 90_000, "ip": f"10.0.1.{i % 4}"}
        for i in range(25)
    ] + [
        {"id": "01", "country": "JP", "device": "android", "time": now_ms - i * 120_000, "ip": f"10.0.2.{i % 3}"}
        for i in range(15)
    ]
    return pd.DataFrame(rows)


def latest_metadata_key(s3) -> str:
    keys = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET):
        keys += [o["Key"] for o in page.get("Contents", []) if o["Key"].endswith(".metadata.json")]
    return sorted(keys)[-1]


def iceberg_events() -> pd.DataFrame:
    import boto3
    from pyiceberg.table import StaticTable

    s3 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=ACCESS_KEY_ID,
        aws_secret_access_key=SECRET_ACCESS_KEY,
        region_name="auto",
    )
    table = StaticTable.from_metadata(
        f"s3://{BUCKET}/{latest_metadata_key(s3)}",
        properties={
            "s3.endpoint": R2_ENDPOINT,
            "s3.access-key-id": ACCESS_KEY_ID,
            "s3.secret-access-key": SECRET_ACCESS_KEY,
            "s3.region": "auto",
        },
    )
    return table.scan(selected_fields=("id", "country", "device", "time", "ip")).to_pandas()


@st.cache_data(ttl=300)
def load_events() -> pd.DataFrame:
    df = sample_events() if USE_SAMPLE else iceberg_events()
    if pd.api.types.is_numeric_dtype(df["time"]):
        df["time"] = pd.to_datetime(df["time"], unit="ms")
    return df


st.set_page_config(page_title="Thống kê truy cập 24h", layout="wide")
st.title("Thống kê truy cập 24h qua")
if USE_SAMPLE:
    st.info("Đang dùng dữ liệu mẫu. Đặt USE_SAMPLE=0 để đọc Iceberg.")

df = load_events()
df = df[df["time"] >= pd.Timestamp.now() - pd.Timedelta(hours=24)]

c1, c2, c3 = st.columns(3)
c1.metric("Số người truy cập (IP duy nhất)", df["ip"].nunique())
c2.metric("Số quốc gia", df["country"].nunique())
c3.metric("Số lượt xem", len(df))

left, right = st.columns(2)
with left:
    st.subheader("Theo quốc gia")
    st.bar_chart(df["country"].value_counts())
with right:
    st.subheader("Theo thiết bị")
    st.bar_chart(df["device"].value_counts())
