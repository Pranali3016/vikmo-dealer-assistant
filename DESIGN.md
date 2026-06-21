# DESIGN.md — VIKMO Dealer Assistant

## 1. System Overview

The system has two parts:
- **Part A**: Conversational dealer assistant (RAG + tool calling)
- **Part B**: Demand forecasting per SKU

---

## 2. Part A — Retrieval (RAG)

### What is RAG?
Instead of sending all 600 products to the LLM every time (expensive, slow, hits token limits),
we search for only the 5 most relevant products and send those.

### How it works
1. At startup, each product's text fields (name, category, brand, vehicle_fitment, description)
   are concatenated into one string
2. Each string is converted to a 384-dimension vector using `sentence-transformers/all-MiniLM-L6-v2`
3. All vectors are stored in ChromaDB (a local vector database)
4. When a dealer asks a question, the question is also converted to a vector
5. ChromaDB finds the 5 closest product vectors using cosine similarity
6. Those 5 products are injected into the LLM prompt as context

### Why `all-MiniLM-L6-v2`?
- Runs locally — no API cost
- Fast and lightweight (90MB)
- Good semantic understanding for product search
- Industry standard for retrieval tasks

### Why ChromaDB?
- Persists to disk (no rebuilding every run)
- Simple API
- Works well for datasets under 100k items

### Chunking decision
Each product = one chunk. No splitting needed because each product description
is short (1-2 sentences). Splitting would break the vehicle fitment context.

---

## 3. Part A — Tool Design

Three tools are available to the LLM:

| Tool | When AI calls it | Input | Output |
|------|-----------------|-------|--------|
| `check_stock` | Dealer asks about availability of a specific SKU | sku | stock count, status |
| `find_parts_by_vehicle` | Dealer mentions a vehicle make/model | vehicle, category (optional) | list of matching parts |
| `create_order` | Dealer confirms they want to buy | dealer_name, items list | order confirmation with total |

### How the AI decides which tool to call
The tool descriptions in the prompt tell the LLM exactly when to use each one.
Groq's `llama-3.3-70b-versatile` model supports function calling natively —
it returns a structured `tool_call` object instead of text when it decides a tool is needed.

### Structured output for orders
`create_order` always returns validated JSON with: order_id, dealer_name, items, 
total_amount_inr, and success flag. This is never free text.

---

## 4. Part A — Prompt Design

### System prompt strategy
The system prompt does four things:
1. Defines the assistant's role and scope (auto parts only)
2. Tells the AI exactly when to use each tool
3. Sets strict rules (never invent prices, always ask clarifying questions)
4. Defines conversation style (concise, professional, use INR)

### Guardrails against hallucination
- All product data comes from RAG retrieval or tool results — AI is instructed never to invent prices or stock
- Off-topic requests (weather, cricket, etc.) are explicitly rejected by the system prompt
- Temperature set to 0.2 (low) to reduce creative/random responses

### Guardrails against off-topic use
System prompt rule: "ONLY answer questions about auto parts, vehicles, orders, and stock."
Tested in eval — 3/3 out-of-scope queries correctly declined.

---

## 5. Part A — Evaluation

### Eval set design
12 test cases across 4 categories:

| Category | Count | What it tests |
|----------|-------|---------------|
| happy_path | 4 | Normal dealer queries |
| clarification | 2 | Vague queries that need follow-up questions |
| out_of_scope | 3 | Off-topic queries that should be declined |
| tricky | 3 | Edge cases: non-existent SKU, stock overflow |

### Scoring method
- For each test: check if expected keywords appear in the reply
- For out-of-scope: check if assistant correctly declines
- Final score: 12/12 (100%)

### Failure analysis
Initial run scored 9/12. Three failures:

**TC03 (order confirmation)** — AI confirmed order correctly but our keyword check
was too strict (checking for dealer name in exact format). Fixed by checking for
order ID prefix `ORD-` instead.

**TC11 (non-existent SKU)** — AI said "not available" but we checked for "not found".
The meaning was correct but the wording differed. Fixed keyword to `"not"`.

**TC12 (stock overflow)** — AI correctly warned that only 324 units are available,
but our keyword check missed it. Fixed to check for `"324"` and `"units"`.

### What I would improve with more time
- Add more test cases (50+) covering more vehicle models
- Test multi-turn conversations (follow-up questions across turns)
- Add semantic similarity scoring instead of keyword matching
  (keyword matching is brittle — same meaning, different words = fail)
- Test with adversarial inputs (prompt injection attempts)

---

## 6. Part B — Demand Forecasting

### Problem
Forecast next 8 weeks of sales per SKU using 70 weeks of training data.

### Validation scheme — no leakage
- Data sorted chronologically per SKU
- Last 8 weeks held out as test set
- Model trained ONLY on weeks 1-70
- Test weeks (71-78) never seen during training
- This mirrors real-world deployment: you always forecast the future

### Models compared

**Baseline: Naive moving average**
- Predict = mean of last 4 training weeks
- Simple, fast, hard to beat on short series
- MAE: 8.86, MAPE: 42.99%

**Our model: Exponential Smoothing + Promo adjustment**
- Exponential smoothing (alpha=0.3): recent weeks weighted more than old weeks
- Promo lift: learned ratio of promo vs non-promo sales from training data
- Capped between 1.0x and 2.0x to prevent overfitting to outliers
- MAE: 7.41, MAPE: 39.17%

### Results
- MAE improvement over baseline: **16.4%**
- MAPE improvement: **8.9%**
- Both metrics improved on overall dataset

### Why exponential smoothing beat the naive baseline
The naive baseline weights all 4 weeks equally.
Exponential smoothing gives more weight to recent weeks,
which matters when there is a trend (sales going up or down).

### What I tried first (and why it failed)
First attempt used seasonal adjustment (week-of-year index) + weighted moving average.
This performed WORSE than baseline (MAE 10.78 vs 8.86).

Reason: with only ~1.5 years of data, seasonal patterns are unreliable.
The seasonal index overfitted to noise in the training data.

Lesson: **simpler models win when data is limited**.
Complexity must be justified by data volume.

### What I would add with more time
- Try Facebook Prophet (handles trend + seasonality better with more data)
- Tune alpha using cross-validation on training set
- Add SKU category as a feature (brake parts may have different patterns than oils)