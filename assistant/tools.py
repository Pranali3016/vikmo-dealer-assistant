import pandas as pd
import json
from datetime import datetime
import random

# Load catalogue once when file is imported
_catalogue_df = None

def _get_catalogue():
    """Load catalogue CSV into memory (only once)"""
    global _catalogue_df
    if _catalogue_df is None:
        _catalogue_df = pd.read_csv("data/catalogue.csv")
    return _catalogue_df


# ─────────────────────────────────────────────
# TOOL 1 — check_stock
# ─────────────────────────────────────────────
def check_stock(sku: str) -> dict:
    """
    Check how many units of a product are available.
    
    Input:  sku = product code like "BRK-1042"
    Output: dictionary with stock info
    """
    df = _get_catalogue()
    
    # Find the product with this SKU
    row = df[df['sku'] == sku]
    
    if row.empty:
        return {
            "found": False,
            "sku": sku,
            "message": f"No product found with SKU {sku}"
        }
    
    product = row.iloc[0]  # Get first (only) matching row
    stock = int(product['stock'])
    
    return {
        "found": True,
        "sku": sku,
        "name": product['name'],
        "stock": stock,
        "status": "in_stock" if stock > 0 else "out_of_stock",
        "message": f"{product['name']} has {stock} units available."
    }


# ─────────────────────────────────────────────
# TOOL 2 — create_order
# ─────────────────────────────────────────────
def create_order(dealer_name: str, items: list) -> dict:
    """
    Place an order for a dealer.
    
    Input:
        dealer_name = "ABC Motors"
        items = [
            {"sku": "BRK-1042", "quantity": 10},
            {"sku": "TYR-1009", "quantity": 5}
        ]
    
    Output: Order confirmation with total price
    """
    df = _get_catalogue()
    
    if not dealer_name or not items:
        return {
            "success": False,
            "message": "Dealer name and items are required."
        }
    
    order_lines = []
    total_amount = 0
    errors = []
    
    for item in items:
        sku = item.get("sku")
        quantity = item.get("quantity", 1)
        
        # Find this product
        row = df[df['sku'] == sku]
        
        if row.empty:
            errors.append(f"SKU {sku} not found in catalogue")
            continue
        
        product = row.iloc[0]
        stock = int(product['stock'])
        price = int(product['price_inr'])
        
        # Check if enough stock
        if stock < quantity:
            errors.append(
                f"{product['name']}: only {stock} units available, you requested {quantity}"
            )
            continue
        
        line_total = price * quantity
        total_amount += line_total
        
        order_lines.append({
            "sku": sku,
            "name": product['name'],
            "quantity": quantity,
            "unit_price_inr": price,
            "line_total_inr": line_total
        })
    
    # If no valid items
    if not order_lines:
        return {
            "success": False,
            "message": "No valid items to order.",
            "errors": errors
        }
    
    # Generate a simple order ID
    order_id = f"ORD-{datetime.now().strftime('%Y%m%d')}-{random.randint(1000,9999)}"
    
    return {
        "success": True,
        "order_id": order_id,
        "dealer_name": dealer_name,
        "items": order_lines,
        "total_amount_inr": total_amount,
        "errors": errors,  # partial errors if some items failed
        "message": f"Order {order_id} placed successfully for {dealer_name}. Total: ₹{total_amount}"
    }


# ─────────────────────────────────────────────
# TOOL 3 — find_parts_by_vehicle
# ─────────────────────────────────────────────
def find_parts_by_vehicle(vehicle: str, category: str = None) -> dict:
    """
    Find all parts that fit a specific vehicle.
    
    Input:
        vehicle  = "Bajaj Pulsar 150"
        category = "Brakes"  (optional filter)
    
    Output: list of matching parts
    """
    df = _get_catalogue()
    
    # Search vehicle_fitment column (case insensitive)
    mask = df['vehicle_fitment'].str.contains(vehicle, case=False, na=False)
    matches = df[mask]
    
    # Also include Universal parts
    universal = df[df['vehicle_fitment'].str.contains('Universal', case=False, na=False)]
    matches = pd.concat([matches, universal]).drop_duplicates(subset='sku')
    
    # Filter by category if given
    if category:
        matches = matches[
            matches['category'].str.contains(category, case=False, na=False)
        ]
    
    if matches.empty:
        return {
            "found": False,
            "vehicle": vehicle,
            "message": f"No parts found for {vehicle}",
            "parts": []
        }
    
    # Return as list of dicts
    parts = matches[['sku','name','category','brand','price_inr','stock']].to_dict(orient='records')
    
    return {
        "found": True,
        "vehicle": vehicle,
        "category_filter": category,
        "total_found": len(parts),
        "parts": parts[:10],  # return top 10 to avoid overloading AI
        "message": f"Found {len(parts)} parts for {vehicle}"
    }


# ─────────────────────────────────────────────
# TOOL REGISTRY — maps tool names to functions
# ─────────────────────────────────────────────
TOOLS = {
    "check_stock": check_stock,
    "create_order": create_order,
    "find_parts_by_vehicle": find_parts_by_vehicle
}

def run_tool(tool_name: str, tool_args: dict) -> str:
    """
    The agent calls this to execute any tool.
    Returns result as JSON string.
    """
    if tool_name not in TOOLS:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})
    
    result = TOOLS[tool_name](**tool_args)
    return json.dumps(result, indent=2)