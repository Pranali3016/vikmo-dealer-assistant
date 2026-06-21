import pandas as pd
import numpy as np
from pathlib import Path


def load_sales_data():
    path = Path("data/sales_history.csv")
    df = pd.read_csv(path, parse_dates=["date"])
    df = df.sort_values(["sku", "date"]).reset_index(drop=True)
    print(f"Loaded {len(df)} rows for {df['sku'].nunique()} SKUs")
    return df


def train_test_split(df, test_weeks=8):
    """
    Hold out last 8 weeks per SKU as test.
    Train only on data before that — zero leakage.
    """
    train_rows = []
    test_rows = []

    for sku, group in df.groupby("sku"):
        group = group.sort_values("date")
        train_rows.append(group.iloc[:-test_weeks])
        test_rows.append(group.iloc[-test_weeks:])

    train = pd.concat(train_rows).reset_index(drop=True)
    test = pd.concat(test_rows).reset_index(drop=True)

    print(f"Train: {train['date'].min().date()} to {train['date'].max().date()}")
    print(f"Test:  {test['date'].min().date()} to {test['date'].max().date()}")
    return train, test


# ─────────────────────────────────────────────
# BASELINE
# ─────────────────────────────────────────────

def naive_baseline(train, test):
    """
    Predict = mean of last 4 weeks of training data.
    This is our benchmark to beat.
    """
    predictions = []
    for sku, test_group in test.groupby("sku"):
        train_group = train[train["sku"] == sku]
        last_4_mean = train_group["units_sold"].iloc[-4:].mean()

        for _, row in test_group.iterrows():
            predictions.append({
                "sku": sku,
                "date": row["date"],
                "actual": row["units_sold"],
                "predicted": round(last_4_mean, 2)
            })
    return pd.DataFrame(predictions)


# ─────────────────────────────────────────────
# OUR MODEL — Exponential Smoothing + Promo
# ─────────────────────────────────────────────

def exponential_smoothing(series, alpha):
    """
    Exponential smoothing manually implemented.

    What it does:
    - Gives more weight to recent observations
    - Old data fades out exponentially
    - alpha = 0.3 means 30% weight on latest, 70% on history
    - Much more stable than weighted average
    
    Formula: smoothed[t] = alpha * actual[t] + (1-alpha) * smoothed[t-1]
    """
    smoothed = [series.iloc[0]]  # start with first value
    for value in series.iloc[1:]:
        smoothed.append(alpha * value + (1 - alpha) * smoothed[-1])
    return smoothed


def our_model(train, test, alpha=0.3):
    """
    Our improved model:

    1. Exponential smoothing — stable trend tracking
       Better than weighted average because it handles
       spikes without overreacting

    2. Promo lift — learned from training data
       If promo_flag=1, multiply by learned lift factor

    Why this beats baseline:
    - Baseline uses simple mean (ignores recent trend)
    - We use exponential smoothing (adapts to recent trend)
    - We also handle promotions which baseline ignores
    """
    predictions = []

    for sku, test_group in test.groupby("sku"):
        train_group = train[train["sku"] == sku].copy()

        # --- Learn promo lift from training data ---
        promo_sales = train_group[train_group["promo_flag"] == 1]["units_sold"].mean()
        normal_sales = train_group[train_group["promo_flag"] == 0]["units_sold"].mean()

        if pd.notna(promo_sales) and pd.notna(normal_sales) and normal_sales > 0:
            promo_lift = promo_sales / normal_sales
            # Cap lift between 1.0 and 2.0 to avoid wild predictions
            promo_lift = min(max(promo_lift, 1.0), 2.0)
        else:
            promo_lift = 1.2

        # --- Apply exponential smoothing on training data ---
        smoothed = exponential_smoothing(train_group["units_sold"], alpha)
        base_pred = smoothed[-1]  # last smoothed value = our base forecast

        # --- Predict each test week ---
        for _, row in test_group.iterrows():
            pred = base_pred

            # Apply promo boost if this week has promotion
            if row["promo_flag"] == 1:
                pred = pred * promo_lift

            predictions.append({
                "sku": sku,
                "date": row["date"],
                "actual": row["units_sold"],
                "predicted": round(max(pred, 0), 2)
            })

    return pd.DataFrame(predictions)


# ─────────────────────────────────────────────
# METRICS
# ─────────────────────────────────────────────

def calculate_metrics(predictions_df):
    df = predictions_df.copy()
    df["error"] = abs(df["actual"] - df["predicted"])
    df["pct_error"] = df["error"] / df["actual"].replace(0, np.nan) * 100

    overall_mae = df["error"].mean()
    overall_mape = df["pct_error"].mean()

    per_sku = df.groupby("sku").agg(
        MAE=("error", "mean"),
        MAPE=("pct_error", "mean")
    ).round(2)

    return overall_mae, overall_mape, per_sku


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main():
    print("=" * 60)
    print("VIKMO DEMAND FORECASTING")
    print("=" * 60)

    df = load_sales_data()
    train, test = train_test_split(df, test_weeks=8)

    print(f"\nTraining weeks per SKU : {len(train) // train['sku'].nunique()}")
    print(f"Test weeks per SKU     : {len(test) // test['sku'].nunique()}")

    # Baseline
    print("\nRunning naive baseline...")
    baseline_preds = naive_baseline(train, test)
    base_mae, base_mape, _ = calculate_metrics(baseline_preds)

    # Our model
    print("Running exponential smoothing model...")
    our_preds = our_model(train, test, alpha=0.3)
    our_mae, our_mape, per_sku = calculate_metrics(our_preds)

    # Results table
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"{'Metric':<20} {'Baseline':>12} {'Our Model':>12} {'Better?':>10}")
    print("-" * 60)
    print(f"{'MAE':<20} {base_mae:>12.2f} {our_mae:>12.2f} {'✅ YES' if our_mae < base_mae else '❌ NO':>10}")
    print(f"{'MAPE (%)':<20} {base_mape:>12.2f} {our_mape:>12.2f} {'✅ YES' if our_mape < base_mape else '❌ NO':>10}")

    print("\nPer-SKU MAE (Our Model):")
    print(per_sku.to_string())

    improvement_mae = round((base_mae - our_mae) / base_mae * 100, 1)
    beat = our_mae < base_mae

    print(f"\n{'✅ Our model beats baseline' if beat else '❌ Baseline still wins'} — MAE improvement: {improvement_mae}%")

    # Save
    our_preds.to_csv("forecasting/forecast_results.csv", index=False)
    print("Forecast saved to forecasting/forecast_results.csv")
    print("=" * 60)


if __name__ == "__main__":
    main()