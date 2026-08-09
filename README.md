# VIKMO Dealer Assistant

AI-powered conversational assistant for auto parts dealers.
Helps dealers find parts, check stock, and place orders using natural language.

---

## What I built

**Part A — Dealer Assistant (core)**
- RAG retrieval over 600-product catalogue using sentence-transformers + ChromaDB
- 3 tools: `check_stock`, `create_order`, `find_parts_by_vehicle`
- Multi-turn conversation with context memory
- Guardrails against hallucination and off-topic queries
- Eval set: 12 test cases, 100% pass rate

**Part B — Demand Forecasting (bonus)**
- Exponential smoothing + promo adjustment
- Beats naive baseline by 16.4% MAE
- Leakage-free backtest (last 8 weeks held out)

---

## Tech Stack

| Component | Tool |
|-----------|------|
| LLM | Groq — llama-3.3-70b-versatile (free) |
| Embeddings | sentence-transformers/all-MiniLM-L6-v2 |
| Vector DB | ChromaDB (local, persistent) |
| Forecasting | Custom exponential smoothing (numpy/pandas) |
| Language | Python 3.11 |

---

## Setup

### 1. Clone and install
```bash
git clone <your-repo-url>
cd vikmo-assistant
pip install -r requirements.txt
```

### 2. Set environment variables
Create a `.env` file in the root folder:
GROQ_API_KEY=your_groq_key_here
Get a free key at: https://console.groq.com

### 3. Add data files
Place these files in the `data/` folder:
- `catalogue.csv`
- `catalogue.json`  
- `sales_history.csv`

---

## How to run

### Run the Web Platform (Recommended) 🌐
```bash
python server.py
```
Open **http://localhost:8000** in your browser to access:
- 🤖 **AI Dealer Copilot**: Multi-turn chat with RAG and tool calls
- 📦 **Smart Catalogue**: Search and vehicle fitment filter across 600+ products
- 🛒 **Orders & Tax Invoices**: Live order placement with printable B2B tax invoices
- 📈 **Demand Forecasting**: Interactive time-series charts, 8-week predictions, and promo simulator
- 🧪 **Live Evaluation Suite**: 12 test cases with 100% pass verification

### Run CLI Assistant
```bash
python -m assistant.agent
```

### Run the evaluation
```bash
python -m eval.run_eval
```

### Run demand forecasting
```bash
python -m forecasting.forecast
```

---

## Example interactions
You: Do you have brake pads for Bajaj Pulsar 150?

Assistant: Yes! Here are brake parts for Bajaj Pulsar 150:

Brake Pad Set — INR 1460 (136 units in stock)
Brake Disc Rotor — INR 2085 (354 units in stock)

Would you like to place an order?

You: I need tyres

Assistant: Sure! Which vehicle are you looking for tyres for?
You: Place an order for 3 units of TYR-1009 for Singh Motors

Assistant: Order ORD-20260621-4584 placed for Singh Motors. Total: INR 10305.
You: What is the weather today?

Assistant: I can only help with auto parts and orders. How can I assist you?

---

## Eval results
Total: 12/12 (100%)

happy_path    : 4/4
clarification : 2/2
out_of_scope  : 3/3
tricky        : 3/3

See `eval/eval_results.json` for full details.

---

## Assumptions

- Vehicle fitment matching is string-based (partial match)
- Orders do not actually deduct from stock (simulation only)
- Forecasting uses weekly granularity only
- See DESIGN.md for full methodology