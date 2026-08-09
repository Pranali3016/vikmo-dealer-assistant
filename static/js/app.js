// VIKMO Auto Parts Assistant & Demand Analytics — Main Frontend Application

let currentChatHistory = [];
let allCatalogueProducts = [];
let forecastChartInstance = null;
let currentForecastSku = "TYR-1009";

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize Lucide Icons
  if (window.lucide) {
    lucide.createIcons();
  }

  initTheme();
  initTabs();
  initChat();
  await loadSystemHealth();
  await loadFilterOptions();
  await loadCatalogue();
  await loadOrders();
  await initForecasting();
  await loadEvaluationSuite();
});

// ─────────────────────────────────────────────
// 1. THEME & TABS CONTROLLER
// ─────────────────────────────────────────────
function initTheme() {
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const themeIcon = document.getElementById("themeIcon");

  themeToggleBtn.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", nextTheme);
    themeIcon.setAttribute("data-lucide", nextTheme === "dark" ? "sun" : "moon");
    lucide.createIcons();

    // Refresh chart theme if chart exists
    if (forecastChartInstance) {
      updateChartColors(nextTheme);
    }
  });
}

function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTabId = btn.getAttribute("data-tab");

      tabBtns.forEach(b => b.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetPane = document.getElementById(targetTabId);
      if (targetPane) {
        targetPane.classList.add("active");
      }

      // Re-trigger layout/icons
      lucide.createIcons();
    });
  });
}

async function loadSystemHealth() {
  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      const data = await res.json();
      const statusPill = document.getElementById("systemStatusText");
      if (statusPill) {
        statusPill.textContent = `${data.total_products} SKUs Loaded • ${data.groq_connected ? "Groq Online" : "Local RAG Mode"}`;
      }
      const navProductCount = document.getElementById("navProductCount");
      if (navProductCount) {
        navProductCount.textContent = `${data.total_products} SKUs`;
      }
    }
  } catch (e) {
    console.warn("Health check error:", e);
  }
}

// ─────────────────────────────────────────────
// 2. AI COPILOT CHAT MODULE
// ─────────────────────────────────────────────
function initChat() {
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendMessageBtn");
  const clearBtn = document.getElementById("clearChatBtn");
  const chips = document.querySelectorAll(".chip-btn");

  sendBtn.addEventListener("click", () => handleUserSend());
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleUserSend();
    }
  });

  clearBtn.addEventListener("click", () => {
    currentChatHistory = [];
    const chatContainer = document.getElementById("chatMessages");
    chatContainer.innerHTML = `
      <div class="message-row assistant">
        <div class="message-bubble">
          <strong>Conversation reset. 🔄</strong>
          <p style="margin-top: 0.25rem; color: var(--text-muted);">
            How can I help you find auto parts or place orders today?
          </p>
        </div>
      </div>
    `;
  });

  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      const query = chip.getAttribute("data-query");
      if (query) {
        chatInput.value = query;
        handleUserSend();
      }
    });
  });
}

async function handleUserSend() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  appendChatMessage("user", text);

  // Show thinking indicator
  const thinkingId = appendThinkingIndicator();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: currentChatHistory
      })
    });

    removeThinkingIndicator(thinkingId);

    if (res.ok) {
      const data = await res.json();
      appendChatMessage("assistant", data.reply, data.tool_calls, data.retrieved_products);

      // Keep client history clean
      currentChatHistory.push({ role: "user", content: text });
      currentChatHistory.push({ role: "assistant", content: data.reply });

      // Refresh orders in case an order was created via tool calling
      loadOrders();
    } else {
      appendChatMessage("assistant", "⚠️ Unable to reach assistant engine. Please try again.");
    }
  } catch (err) {
    removeThinkingIndicator(thinkingId);
    appendChatMessage("assistant", `⚠️ Connection error: ${err.message}`);
  }
}

function appendChatMessage(role, text, toolCalls = [], retrievedProducts = []) {
  const container = document.getElementById("chatMessages");
  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  let toolContentHtml = "";

  // Render tool execution badges & details
  if (toolCalls && toolCalls.length > 0) {
    toolCalls.forEach(tc => {
      const toolName = tc.tool;
      const res = tc.result;

      if (toolName === "create_order" && res && res.success) {
        toolContentHtml += `
          <div class="order-ticket">
            <div class="order-ticket-header">
              <span>🧾 Order Confirmed: ${res.order_id}</span>
              <span>₹${res.total_amount_inr}</span>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-main);">
              <strong>Dealer:</strong> ${res.dealer_name}<br>
              <strong>Items:</strong> ${(res.items || []).map(i => `${i.sku} (x${i.quantity || 1})`).join(", ")}
            </div>
          </div>
        `;
      } else if (toolName === "check_stock" && res) {
        toolContentHtml += `
          <div class="tool-card">
            <span class="tool-badge">🔍 Stock Check Result</span>
            <div style="font-weight: 600; color: #fff;">${res.name || res.sku}</div>
            <div style="color: ${res.stock > 0 ? '#34d399' : '#fb7185'}; margin-top: 0.2rem;">
              ${res.stock > 0 ? `✅ In Stock: ${res.stock} units` : '❌ Out of Stock'}
            </div>
          </div>
        `;
      } else if (toolName === "find_parts_by_vehicle" && res && res.length > 0) {
        toolContentHtml += `
          <div class="tool-card">
            <span class="tool-badge">🏍️ Vehicle Fitment Matches</span>
            <div class="tool-product-grid">
              ${res.slice(0, 3).map(p => `
                <div class="tool-product-row">
                  <div>
                    <div style="font-weight: 600; color: #fff;">${p.name}</div>
                    <div style="font-size: 0.72rem; color: var(--text-dim);">${p.sku} &bull; ${p.category}</div>
                  </div>
                  <div style="text-align: right;">
                    <div style="font-weight: 700; color: #38bdf8;">₹${p.price_inr}</div>
                    <div style="font-size: 0.7rem; color: #34d399;">${p.stock} in stock</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }
    });
  }

  // Format basic markdown like bold, italics, bullets, inline code
  let formattedText = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.08); padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.82em; color: #38bdf8;">$1</code>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n• /g, '<br>• ')
    .replace(/\n- /g, '<br>- ');

  row.innerHTML = `
    <div class="message-bubble">
      <div>${formattedText}</div>
      ${toolContentHtml}
    </div>
  `;

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  lucide.createIcons();
}

function appendThinkingIndicator() {
  const container = document.getElementById("chatMessages");
  const id = "thinking-" + Date.now();
  const row = document.createElement("div");
  row.className = "message-row assistant";
  row.id = id;
  row.innerHTML = `
    <div class="message-bubble" style="display: flex; align-items: center; gap: 0.5rem; color: var(--text-muted);">
      <span class="status-dot" style="width: 6px; height: 6px;"></span>
      <span style="font-size: 0.82rem;">VIKMO AI Copilot is thinking...</span>
    </div>
  `;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeThinkingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ─────────────────────────────────────────────
// 3. SMART PRODUCT CATALOGUE
// ─────────────────────────────────────────────
async function loadFilterOptions() {
  try {
    const [vehRes, catRes, brRes] = await Promise.all([
      fetch("/api/vehicles"),
      fetch("/api/categories"),
      fetch("/api/brands")
    ]);

    if (vehRes.ok) {
      const vehicles = await vehRes.json();
      const sel = document.getElementById("vehicleFilter");
      vehicles.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = `🏍️ ${v}`;
        sel.appendChild(opt);
      });
    }

    if (catRes.ok) {
      const categories = await catRes.json();
      const sel = document.getElementById("categoryFilter");
      categories.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = `📂 ${c}`;
        sel.appendChild(opt);
      });
    }

    if (brRes.ok) {
      const brands = await brRes.json();
      const sel = document.getElementById("brandFilter");
      brands.forEach(b => {
        const opt = document.createElement("option");
        opt.value = b;
        opt.textContent = `🏷️ ${b}`;
        sel.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn("Filter loading error:", e);
  }
}

async function loadCatalogue(page = 1) {
  const search = document.getElementById("catalogueSearchInput").value;
  const vehicle = document.getElementById("vehicleFilter").value;
  const category = document.getElementById("categoryFilter").value;
  const brand = document.getElementById("brandFilter").value;
  const stock = document.getElementById("stockFilter").value;
  const sort = document.getElementById("sortFilter").value;

  const params = new URLSearchParams({
    page: page,
    limit: 24,
    sort_by: sort
  });

  if (search) params.append("q", search);
  if (vehicle !== "all") params.append("vehicle", vehicle);
  if (category !== "all") params.append("category", category);
  if (brand !== "all") params.append("brand", brand);
  if (stock !== "all") params.append("stock_status", stock);

  try {
    const res = await fetch(`/api/catalogue?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      renderCatalogueGrid(data.items);

      const countEl = document.getElementById("catalogueResultCount");
      if (countEl) {
        countEl.textContent = `Showing ${data.items.length} of ${data.total} products (Page ${data.page} of ${data.pages || 1})`;
      }

      renderPagination(data.page, data.pages);
    }
  } catch (e) {
    console.error("Catalogue error:", e);
  }
}

function renderCatalogueGrid(products) {
  const grid = document.getElementById("productsGrid");
  grid.innerHTML = "";

  if (!products || products.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-dim);">
        <i data-lucide="package-search" style="width: 48px; height: 48px; margin-bottom: 0.5rem;"></i>
        <div style="font-size: 1.1rem; font-weight: 600;">No auto parts found</div>
        <div style="font-size: 0.85rem;">Try adjusting your search keywords or filter criteria.</div>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  products.forEach(p => {
    const card = document.createElement("div");
    card.className = "glass product-card";

    let stockTagClass = "in-stock";
    let stockLabel = `In Stock (${p.stock})`;
    if (p.stock === 0) {
      stockTagClass = "out-stock";
      stockLabel = "Out of Stock";
    } else if (p.stock <= 10) {
      stockTagClass = "low-stock";
      stockLabel = `Low Stock (${p.stock})`;
    }

    card.innerHTML = `
      <div>
        <div class="product-card-top">
          <span class="product-sku">${p.sku}</span>
          <span class="stock-tag ${stockTagClass}">${stockLabel}</span>
        </div>
        <h4 class="product-name">${p.name}</h4>
        <div class="product-fitment">
          <i data-lucide="bike" style="width: 14px; height: 14px; color: var(--primary);"></i>
          <span>${p.vehicle_fitment}</span>
          <span style="color: var(--text-dim);">&bull;</span>
          <span>${p.brand}</span>
        </div>
        <div style="font-size: 0.78rem; color: var(--text-dim); line-height: 1.4; margin-bottom: 0.5rem;">
          ${p.description || ''}
        </div>
      </div>

      <div>
        <div class="product-price-row">
          <div>
            <div style="font-size: 0.7rem; color: var(--text-dim); text-transform: uppercase;">Wholesale Price</div>
            <div class="product-price">₹${Number(p.price_inr).toLocaleString('en-IN')}</div>
          </div>
          <div style="display: flex; gap: 0.4rem;">
            <button class="btn-icon ask-ai-btn" data-sku="${p.sku}" data-name="${p.name}" title="Ask AI about this part">
              <i data-lucide="message-square-more"></i>
            </button>
            <button class="btn-icon quick-order-btn" data-sku="${p.sku}" data-name="${p.name}" data-price="${p.price_inr}" title="Quick Order" style="background: rgba(99,102,241,0.2); color: #a5b4fc;">
              <i data-lucide="shopping-cart"></i>
            </button>
          </div>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });

  // Attach quick action listeners
  document.querySelectorAll(".ask-ai-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const sku = btn.getAttribute("data-sku");
      const name = btn.getAttribute("data-name");
      // Switch to Copilot tab
      document.querySelector('[data-tab="tab-copilot"]').click();
      const input = document.getElementById("chatInput");
      input.value = `Check stock and details for ${sku} (${name})`;
      handleUserSend();
    });
  });

  document.querySelectorAll(".quick-order-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const sku = btn.getAttribute("data-sku");
      openManualOrderModal(sku);
    });
  });

  lucide.createIcons();
}

function renderPagination(current, total) {
  const container = document.getElementById("cataloguePagination");
  if (!container || total <= 1) {
    if (container) container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <button class="btn-icon" ${current <= 1 ? 'disabled style="opacity: 0.4;"' : ''} id="prevPageBtn">
      <i data-lucide="chevron-left"></i>
    </button>
    <span style="font-size: 0.85rem; padding: 0.4rem 0.6rem; color: var(--text-muted);">${current} / ${total}</span>
    <button class="btn-icon" ${current >= total ? 'disabled style="opacity: 0.4;"' : ''} id="nextPageBtn">
      <i data-lucide="chevron-right"></i>
    </button>
  `;

  document.getElementById("prevPageBtn")?.addEventListener("click", () => loadCatalogue(current - 1));
  document.getElementById("nextPageBtn")?.addEventListener("click", () => loadCatalogue(current + 1));
  lucide.createIcons();
}

// Catalogue filter events
let searchDebounceTimeout;
document.getElementById("catalogueSearchInput")?.addEventListener("input", () => {
  clearTimeout(searchDebounceTimeout);
  searchDebounceTimeout = setTimeout(() => loadCatalogue(1), 300);
});
document.getElementById("vehicleFilter")?.addEventListener("change", () => loadCatalogue(1));
document.getElementById("categoryFilter")?.addEventListener("change", () => loadCatalogue(1));
document.getElementById("brandFilter")?.addEventListener("change", () => loadCatalogue(1));
document.getElementById("stockFilter")?.addEventListener("change", () => loadCatalogue(1));
document.getElementById("sortFilter")?.addEventListener("change", () => loadCatalogue(1));

// ─────────────────────────────────────────────
// 4. ORDERS & INVOICE MANAGER
// ─────────────────────────────────────────────
async function loadOrders() {
  try {
    const res = await fetch("/api/orders");
    if (res.ok) {
      const orders = await res.json();
      renderOrdersTable(orders);

      const navOrderCount = document.getElementById("navOrderCount");
      if (navOrderCount) {
        navOrderCount.textContent = orders.length;
      }
    }
  } catch (e) {
    console.warn("Orders error:", e);
  }
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById("ordersTableBody");
  tbody.innerHTML = "";

  if (!orders || orders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-dim); padding: 2rem;">
          No orders created yet. Place an order through the AI Copilot or Catalogue!
        </td>
      </tr>
    `;
    return;
  }

  orders.forEach(ord => {
    const tr = document.createElement("tr");

    const itemsSummary = (ord.items || []).map(i => {
      const qty = i.quantity || 1;
      const sku = i.sku || 'SKU';
      return `<span style="background: rgba(255,255,255,0.06); padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.75rem; margin-right: 0.3rem;">${sku} (x${qty})</span>`;
    }).join('');

    tr.innerHTML = `
      <td style="font-family: monospace; font-weight: 700; color: #38bdf8;">${ord.order_id}</td>
      <td style="font-weight: 600;">${ord.dealer_name}</td>
      <td style="color: var(--text-muted); font-size: 0.82rem;">${ord.timestamp}</td>
      <td>${itemsSummary}</td>
      <td style="font-weight: 700; color: #34d399;">₹${Number(ord.total_amount_inr).toLocaleString('en-IN')}</td>
      <td>
        <span class="stock-tag in-stock" style="font-size: 0.72rem;">${ord.status || 'Confirmed'}</span>
      </td>
      <td>
        <button class="btn-icon view-invoice-btn" data-order='${JSON.stringify(ord)}' title="View Tax Invoice">
          <i data-lucide="file-text"></i>
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  document.querySelectorAll(".view-invoice-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ordData = JSON.parse(btn.getAttribute("data-order"));
      openInvoiceModal(ordData);
    });
  });

  lucide.createIcons();
}

function openInvoiceModal(ord) {
  const modal = document.getElementById("invoiceModal");
  const modalId = document.getElementById("modalInvoiceId");
  const content = document.getElementById("invoiceContentArea");

  modalId.textContent = `Invoice No: ${ord.order_id} • Date: ${ord.timestamp}`;

  let itemsRows = (ord.items || []).map((i, idx) => {
    const qty = i.quantity || 1;
    const price = i.unit_price || (ord.total_amount_inr / qty);
    const subtotal = price * qty;
    return `
      <tr>
        <td style="padding: 0.5rem 0;">${idx + 1}. <strong>${i.name || i.sku}</strong> (${i.sku})</td>
        <td style="text-align: center;">${qty}</td>
        <td style="text-align: right;">₹${Number(price).toLocaleString('en-IN')}</td>
        <td style="text-align: right; font-weight: 600;">₹${Number(subtotal).toLocaleString('en-IN')}</td>
      </tr>
    `;
  }).join('');

  content.innerHTML = `
    <div style="background: rgba(30, 41, 59, 0.5); padding: 1rem; border-radius: var(--radius-sm); margin-bottom: 1rem;">
      <div style="font-size: 0.8rem; color: var(--text-dim); text-transform: uppercase;">Billed To Dealer:</div>
      <div style="font-size: 1.1rem; font-weight: 700; color: #fff;">${ord.dealer_name}</div>
      <div style="font-size: 0.8rem; color: var(--text-muted);">Authorized Auto Spares Distributor Account</div>
    </div>

    <table style="width: 100%; border-collapse: collapse; margin-bottom: 1rem;">
      <thead>
        <tr style="border-bottom: 1px solid var(--border-subtle); color: var(--text-dim); font-size: 0.78rem; text-transform: uppercase;">
          <th style="text-align: left; padding-bottom: 0.5rem;">Product & SKU</th>
          <th style="text-align: center; padding-bottom: 0.5rem;">Qty</th>
          <th style="text-align: right; padding-bottom: 0.5rem;">Unit Price</th>
          <th style="text-align: right; padding-bottom: 0.5rem;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <div style="border-top: 1px solid var(--border-subtle); padding-top: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
      <span style="font-weight: 600;">Total Payable (INR):</span>
      <span style="font-size: 1.3rem; font-weight: 800; color: #34d399;">₹${Number(ord.total_amount_inr).toLocaleString('en-IN')}</span>
    </div>
  `;

  modal.classList.add("open");
  lucide.createIcons();
}

document.getElementById("closeInvoiceModalBtn")?.addEventListener("click", () => {
  document.getElementById("invoiceModal")?.classList.remove("open");
});

// Manual Order Modal
function openManualOrderModal(preselectedSku = null) {
  const modal = document.getElementById("manualOrderModal");
  const skuSelect = document.getElementById("manualOrderSku");

  // Populate SKU dropdown if empty
  if (skuSelect.options.length === 0) {
    fetch("/api/catalogue?limit=100")
      .then(res => res.json())
      .then(data => {
        data.items.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.sku;
          opt.textContent = `${p.sku} — ${p.name} (₹${p.price_inr})`;
          skuSelect.appendChild(opt);
        });
        if (preselectedSku) skuSelect.value = preselectedSku;
      });
  } else if (preselectedSku) {
    skuSelect.value = preselectedSku;
  }

  modal.classList.add("open");
}

document.getElementById("openManualOrderModalBtn")?.addEventListener("click", () => openManualOrderModal());
document.getElementById("closeManualOrderModalBtn")?.addEventListener("click", () => {
  document.getElementById("manualOrderModal")?.classList.remove("open");
});

document.getElementById("createOrderForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const dealer = document.getElementById("manualDealerName").value;
  const sku = document.getElementById("manualOrderSku").value;
  const qty = parseInt(document.getElementById("manualOrderQty").value) || 1;

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealer_name: dealer,
        items: [{ sku: sku, quantity: qty }]
      })
    });

    if (res.ok) {
      const order = await res.json();
      document.getElementById("manualOrderModal")?.classList.remove("open");
      await loadOrders();
      openInvoiceModal(order);
    } else {
      const err = await res.json();
      alert("Order failed: " + (err.message || "Out of stock or invalid items"));
    }
  } catch (err) {
    alert("Order creation failed: " + err.message);
  }
});

// ─────────────────────────────────────────────
// 5. DEMAND FORECASTING & ACCURACY CHARTS
// ─────────────────────────────────────────────
async function initForecasting() {
  try {
    const [summaryRes, catRes] = await Promise.all([
      fetch("/api/forecast/summary"),
      fetch("/api/catalogue?limit=50")
    ]);

    if (summaryRes.ok) {
      const summary = await summaryRes.json();
      document.getElementById("metricModelMae").textContent = summary.metrics.model_mae.toFixed(2);
      document.getElementById("metricBaselineMae").textContent = summary.metrics.baseline_mae.toFixed(2);

      renderStockoutRadarTable(summary.stockout_risks);
    }

    if (catRes.ok) {
      const catData = await catRes.json();
      const skuPicker = document.getElementById("forecastSkuPicker");
      skuPicker.innerHTML = "";
      catData.items.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.sku;
        opt.textContent = `${p.sku} &bull; ${p.name}`;
        skuPicker.appendChild(opt);
      });

      skuPicker.addEventListener("change", (e) => {
        currentForecastSku = e.target.value;
        loadSkuForecastChart(currentForecastSku, getPromoLift());
      });
    }

    const promoSlider = document.getElementById("promoSlider");
    promoSlider.addEventListener("input", (e) => {
      const lift = parseFloat(e.target.value);
      document.getElementById("promoSliderVal").textContent = `+${Math.round(lift * 100)}%`;
      loadSkuForecastChart(currentForecastSku, lift);
    });

    // Initial load
    await loadSkuForecastChart(currentForecastSku, 0.0);

  } catch (e) {
    console.warn("Forecasting initialization error:", e);
  }
}

function getPromoLift() {
  const slider = document.getElementById("promoSlider");
  return slider ? parseFloat(slider.value) : 0.0;
}

async function loadSkuForecastChart(sku, promoLift = 0.0) {
  try {
    const res = await fetch(`/api/forecast/sku/${sku}?promo_lift=${promoLift}`);
    if (res.ok) {
      const data = await res.json();
      renderForecastChart(data);
    }
  } catch (e) {
    console.error("SKU forecast chart error:", e);
  }
}

function renderForecastChart(data) {
  const canvas = document.getElementById("forecastChartCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  // Build unified timeline
  const historyLabels = data.history.map(h => h.date);
  const historyValues = data.history.map(h => h.units_sold);

  const forecastLabels = data.forecast.map(f => f.date);
  const modelForecastValues = data.forecast.map(f => f.model_forecast);
  const baselineForecastValues = data.forecast.map(f => f.baseline_forecast);

  const combinedLabels = [...historyLabels, ...forecastLabels];
  
  // Pad arrays with nulls so lines connect properly
  const historicalSeries = [...historyValues, ...forecastLabels.map(() => null)];
  
  const modelSeries = [
    ...historyLabels.slice(0, -1).map(() => null),
    historyValues[historyValues.length - 1],
    ...modelForecastValues
  ];

  const baselineSeries = [
    ...historyLabels.slice(0, -1).map(() => null),
    historyValues[historyValues.length - 1],
    ...baselineForecastValues
  ];

  if (forecastChartInstance) {
    forecastChartInstance.destroy();
  }

  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  const gridColor = isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";
  const textColor = isLight ? "#475569" : "#94a3b8";

  forecastChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: combinedLabels,
      datasets: [
        {
          label: 'Historical Weekly Sales (Actual)',
          data: historicalSeries,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.15)',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          borderWidth: 2
        },
        {
          label: 'VIKMO Model Forecast (+16.4% Acc)',
          data: modelSeries,
          borderColor: '#10b981',
          borderDash: [5, 5],
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.25,
          pointRadius: 4,
          borderWidth: 2.5
        },
        {
          label: 'Naive Baseline (4W Moving Avg)',
          data: baselineSeries,
          borderColor: '#f43f5e',
          borderDash: [2, 4],
          tension: 0,
          pointRadius: 2,
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: textColor,
            font: { family: "'Inter', sans-serif", size: 12, weight: '500' }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#fff',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(99,102,241,0.3)',
          borderWidth: 1,
          padding: 10
        }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor, maxTicksLimit: 12 }
        },
        y: {
          grid: { color: gridColor },
          ticks: { color: textColor },
          title: {
            display: true,
            text: 'Units Sold / Projected',
            color: textColor
          }
        }
      }
    }
  });
}

function updateChartColors(theme) {
  if (!forecastChartInstance) return;
  const isLight = theme === "light";
  const gridColor = isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";
  const textColor = isLight ? "#475569" : "#94a3b8";

  forecastChartInstance.options.scales.x.grid.color = gridColor;
  forecastChartInstance.options.scales.y.grid.color = gridColor;
  forecastChartInstance.options.scales.x.ticks.color = textColor;
  forecastChartInstance.options.scales.y.ticks.color = textColor;
  forecastChartInstance.options.plugins.legend.labels.color = textColor;
  forecastChartInstance.update();
}

function renderStockoutRadarTable(risks) {
  const tbody = document.getElementById("stockoutRadarTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!risks || risks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim);">No stockout risks detected. Inventory levels healthy.</td></tr>`;
    return;
  }

  risks.forEach(r => {
    const tr = document.createElement("tr");
    const isHigh = r.stockout_risk === "HIGH";

    tr.innerHTML = `
      <td style="font-family: monospace; font-weight: 700; color: #38bdf8;">${r.sku}</td>
      <td style="font-weight: 600;">${r.name}</td>
      <td style="color: var(--text-muted);">${r.category}</td>
      <td style="font-weight: 700; color: ${isHigh ? '#fb7185' : '#fbbf24'};">${r.current_stock} units</td>
      <td>~${r.weekly_velocity} / wk</td>
      <td style="font-weight: 600;">${r.projected_8w_demand} units</td>
      <td>
        <span class="stock-tag ${isHigh ? 'out-stock' : 'low-stock'}" style="font-size: 0.72rem;">
          ${r.stockout_risk} RISK
        </span>
      </td>
      <td style="font-weight: 700; color: #34d399;">+${r.recommended_reorder} units</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─────────────────────────────────────────────
// 6. LIVE EVALUATION SUITE RUNNER
// ─────────────────────────────────────────────
async function loadEvaluationSuite() {
  const runBtn = document.getElementById("runEvalBtn");
  runBtn?.addEventListener("click", () => executeLiveEvaluation());
  await executeLiveEvaluation();
}

async function executeLiveEvaluation() {
  const runBtn = document.getElementById("runEvalBtn");
  if (runBtn) {
    runBtn.disabled = true;
    runBtn.innerHTML = `
      <span class="status-dot" style="width: 8px; height: 8px;"></span>
      <span>Running 12 Test Cases...</span>
    `;
  }

  try {
    const res = await fetch("/api/eval/run", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      renderEvaluationResults(data);
    }
  } catch (e) {
    console.error("Eval error:", e);
  } finally {
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.innerHTML = `
        <i data-lucide="play" style="width: 16px; height: 16px;"></i>
        <span>Re-Run Test Suite (12 Tests)</span>
      `;
      lucide.createIcons();
    }
  }
}

function renderEvaluationResults(data) {
  document.getElementById("evalOverallScore").textContent = `${data.passed} / ${data.total_tests} (${data.score_pct}%)`;
  
  const cats = data.by_category || {};
  if (cats.happy_path) document.getElementById("evalHappyScore").textContent = `${cats.happy_path.passed} / ${cats.happy_path.total}`;
  if (cats.clarification) document.getElementById("evalClarifyScore").textContent = `${cats.clarification.passed} / ${cats.clarification.total}`;
  if (cats.out_of_scope) document.getElementById("evalScopeScore").textContent = `${cats.out_of_scope.passed} / ${cats.out_of_scope.total}`;
  if (cats.tricky) document.getElementById("evalTrickyScore").textContent = `${cats.tricky.passed} / ${cats.tricky.total}`;

  const grid = document.getElementById("evalTestCasesGrid");
  grid.innerHTML = "";

  (data.results || []).forEach(tc => {
    const card = document.createElement("div");
    card.className = `eval-case-card ${tc.passed ? 'passed' : 'failed'}`;

    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
        <span style="font-family: monospace; font-size: 0.72rem; font-weight: 700; color: #a5b4fc;">[${tc.id}] ${tc.category.toUpperCase()}</span>
        <span class="stock-tag ${tc.passed ? 'in-stock' : 'out-stock'}" style="font-size: 0.7rem;">
          ${tc.passed ? 'PASSED ✅' : 'FAILED ❌'}
        </span>
      </div>
      <div style="font-size: 0.85rem; font-weight: 600; color: #fff; margin-bottom: 0.35rem;">${tc.description}</div>
      <div style="font-size: 0.78rem; color: var(--accent-cyan); margin-bottom: 0.4rem;">
        <strong>Prompt:</strong> "${tc.input}"
      </div>
      <div style="font-size: 0.75rem; color: var(--text-dim); background: rgba(0,0,0,0.3); padding: 0.4rem 0.6rem; border-radius: 4px; line-height: 1.4;">
        ${tc.reply_snippet || ''}
      </div>
    `;

    grid.appendChild(card);
  });

  lucide.createIcons();
}
