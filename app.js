(function () {
  "use strict";

  const STORAGE_KEY = "micro-corp-ledger-v1";
  const INITIAL_ACCOUNTS = ["売掛金", "普通預金", "現金", "雑収入", "消耗品費", "法定福利費", "役員報酬", "売上高"];
  const columns = [
    ["date", "日付"],
    ["debit", "借方"],
    ["debitAmount", "金額"],
    ["credit", "貸方"],
    ["subAccount", "補助科目"],
    ["creditAmount", "金額"],
    ["summary", "摘要"]
  ];
  const receivableColumns = [
    ["date", "日付"],
    ["client", "取引先"],
    ["detail", "内容"],
    ["amount", "金額"],
    ["expectedDate", "入金予定日"],
    ["paid", "入金済み"],
    ["memo", "メモ"]
  ];

  const MIN_VISIBLE_ROWS = 20;

  const state = {
    data: loadData(),
    currentYear: String(new Date().getFullYear()),
    currentMonth: String(new Date().getMonth() + 1).padStart(2, "0"),
    receivableYear: String(new Date().getFullYear()),
    receivableMonth: String(new Date().getMonth() + 1).padStart(2, "0"),
    receivableSelectedDate: "",
    appMode: "ledger",
    activeView: "ledger"
  };

  const els = {};
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindElements();
    const current = getCurrentPeriod();
    state.currentYear = current.year;
    state.currentMonth = current.month;
    state.receivableYear = current.year;
    state.receivableMonth = current.month;
    state.receivableSelectedDate = isoDate(current.year, current.month, "01");
    els.yearInput.value = state.currentYear;
    els.monthSelect.value = state.currentMonth;
    ensureMonth(monthKey());
    ensureReceivables();
    bindEvents();
    render();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  }

  function bindElements() {
    [
      "appTitle", "receivableTotals", "saveStatus", "lockBadge", "backToLedgerButton", "yearInput", "monthSelect", "addRowButton", "sortByDateButton",
      "printButton", "csvButton", "toggleLockButton", "deleteMonthButton", "ledgerTab", "accountsTab",
      "openReceivablesButton", "backupTab", "ledgerView", "accountsView", "receivablesView", "backupView", "lockedNotice", "accountSuggest",
      "rowsContainer", "emptyState", "accountForm", "accountInput", "accountsList", "backupButton",
      "restoreInput", "printTitle", "printRows", "clientSuggest", "receivablePrevMonthButton",
      "receivableNextMonthButton", "receivableMonthLabel", "receivableCalendar",
      "receivableSelectedLabel", "receivableForm", "receivableClientInput",
      "receivableAmountInput", "receivableDetailInput", "receivableDetailList"
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.yearInput.addEventListener("change", changePeriod);
    els.monthSelect.addEventListener("change", changePeriod);

    els.addRowButton.addEventListener("click", () => {
      if (isLocked()) return;
      currentRows().push(createRow());
      save();
      renderLedger();
      focusLastRow();
    });

    els.sortByDateButton.addEventListener("click", () => {
      if (isLocked()) return;
      sortDatedRowsOnly();
      save();
      renderLedger();
    });

    els.printButton.addEventListener("click", () => { renderPrintRows(); window.print(); });
    els.csvButton.addEventListener("click", downloadCsv);
    els.toggleLockButton.addEventListener("click", toggleLock);
    els.deleteMonthButton.addEventListener("click", deleteCurrentMonth);

    els.ledgerTab.addEventListener("click", () => setView("ledger"));
    els.accountsTab.addEventListener("click", () => setView("accounts"));
    els.backupTab.addEventListener("click", () => setView("backup"));
    els.openReceivablesButton.addEventListener("click", openReceivablesMode);
    els.backToLedgerButton.addEventListener("click", closeReceivablesMode);

    els.rowsContainer.addEventListener("input", handleRowInput);
    els.rowsContainer.addEventListener("focusin", handleAccountSuggestFocus);
    els.rowsContainer.addEventListener("blur", handleCellBlur, true);
    els.rowsContainer.addEventListener("focusin", keepFocusedRowVisible);
    els.rowsContainer.addEventListener("click", handleRowAction);
    els.accountSuggest.addEventListener("pointerdown", chooseSuggestedAccount);
    document.addEventListener("pointerdown", hideAccountSuggestOnOutside);
    document.addEventListener("pointerdown", hideClientSuggestOnOutside);
    els.rowsContainer.addEventListener("keydown", handleCellKeydown);

    els.receivablePrevMonthButton.addEventListener("click", () => moveReceivableMonth(-1));
    els.receivableNextMonthButton.addEventListener("click", () => moveReceivableMonth(1));
    els.receivableForm.addEventListener("submit", addReceivableForSelectedDate);
    els.receivableClientInput.addEventListener("focus", () => showClientSuggest(els.receivableClientInput));
    els.receivableAmountInput.addEventListener("input", () => { els.receivableAmountInput.value = formatAmount(els.receivableAmountInput.value); });
    els.receivableCalendar.addEventListener("click", selectReceivableDate);
    els.receivableDetailList.addEventListener("click", handleReceivableAction);
    els.clientSuggest.addEventListener("pointerdown", chooseSuggestedClient);

    els.accountForm.addEventListener("submit", addAccount);
    els.accountsList.addEventListener("click", removeAccount);
    els.backupButton.addEventListener("click", downloadBackup);
    els.restoreInput.addEventListener("change", restoreBackup);
  }

  function loadData() {
    const fallback = { version: 3, accounts: INITIAL_ACCOUNTS.slice(), recentSubAccounts: [], recentClients: [], months: {}, receivables: { rows: [] }, lastSavedAt: "" };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        version: 3,
        accounts: Array.isArray(parsed.accounts) && parsed.accounts.length ? parsed.accounts : INITIAL_ACCOUNTS.slice(),
        recentSubAccounts: Array.isArray(parsed.recentSubAccounts) ? parsed.recentSubAccounts.map((name) => String(name).trim()).filter(Boolean).slice(0, 6) : [],
        recentClients: Array.isArray(parsed.recentClients) ? parsed.recentClients.map((name) => String(name).trim()).filter(Boolean).slice(0, 6) : [],
        months: parsed.months && typeof parsed.months === "object" ? parsed.months : {},
        receivables: parsed.receivables && typeof parsed.receivables === "object" && Array.isArray(parsed.receivables.rows) ? parsed.receivables : { rows: [] },
        lastSavedAt: parsed.lastSavedAt || ""
      };
    } catch {
      return fallback;
    }
  }

  function save() {
    state.data.lastSavedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    renderSaveStatus();
  }

  function getCurrentPeriod() {
    const now = new Date();
    return { year: String(now.getFullYear()), month: String(now.getMonth() + 1).padStart(2, "0") };
  }

  function monthKey() { return `${state.currentYear}-${state.currentMonth}`; }

  function changePeriod() {
    state.currentYear = String(els.yearInput.value || new Date().getFullYear());
    state.currentMonth = String(els.monthSelect.value || "01").padStart(2, "0");
    ensureMonth(monthKey());
    save();
    render();
  }

  function ensureMonth(key) {
    if (!state.data.months[key]) state.data.months[key] = { locked: false, rows: [] };
    normalizeRows(state.data.months[key].rows);
  }

  function currentMonthData() {
    if (!state.data.months[monthKey()]) ensureMonth(monthKey());
    return state.data.months[monthKey()];
  }
  function currentRows() { return currentMonthData().rows; }
  function isLocked() { return Boolean(currentMonthData().locked); }
  function ensureReceivables() {
    if (!state.data.receivables || typeof state.data.receivables !== "object") state.data.receivables = { rows: [] };
    if (!Array.isArray(state.data.receivables.rows)) state.data.receivables.rows = [];
    normalizeReceivableRows(state.data.receivables.rows);
  }
  function receivableRows() {
    ensureReceivables();
    return state.data.receivables.rows;
  }

  function createRow() {
    return { id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, date: "", debit: "", debitAmount: "", credit: "", subAccount: "", creditAmount: "", summary: "" };
  }

  function createReceivableRow() {
    return { id: `receivable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, date: "", client: "", detail: "", amount: "", expectedDate: "", paid: false, memo: "" };
  }

  function isBlankRow(row) {
    return columns.every(([key]) => !String(row[key] || "").trim());
  }

  function isBlankReceivableRow(row) {
    return receivableColumns.every(([key]) => key === "paid" ? !row.paid : !String(row[key] || "").trim());
  }

  function normalizeRows(rows) {
    const filled = rows.filter((row) => !isBlankRow(row));
    const blanks = rows.filter((row) => isBlankRow(row));
    const targetLength = Math.max(MIN_VISIBLE_ROWS, filled.length + 1);
    const normalized = filled.concat(blanks.slice(0, targetLength - filled.length));
    while (normalized.length < targetLength) normalized.push(createRow());

    const changed = normalized.length !== rows.length || normalized.some((row, index) => row !== rows[index]);
    if (changed) rows.splice(0, rows.length, ...normalized);
    return changed;
  }

  function normalizeReceivableRows(rows) {
    const filled = rows.filter((row) => !isBlankReceivableRow(row));
    const blanks = rows.filter((row) => isBlankReceivableRow(row));
    const targetLength = Math.max(MIN_VISIBLE_ROWS, filled.length + 1);
    const normalized = filled.concat(blanks.slice(0, targetLength - filled.length));
    while (normalized.length < targetLength) normalized.push(createReceivableRow());

    const changed = normalized.length !== rows.length || normalized.some((row, index) => row !== rows[index]);
    if (changed) rows.splice(0, rows.length, ...normalized);
    return changed;
  }

  function render() {
    renderSaveStatus();
    renderTabs();
    renderAppMode();
    renderAccounts();
    renderLedger();
    renderReceivables();
    renderPrintRows();
  }

  function renderSaveStatus() {
    els.saveStatus.textContent = `最終保存時刻: ${state.data.lastSavedAt ? formatDateTime(state.data.lastSavedAt) : "未保存"}`;
  }

  function renderTabs() {
    [["ledger", els.ledgerTab, els.ledgerView], ["accounts", els.accountsTab, els.accountsView], ["backup", els.backupTab, els.backupView]].forEach(([name, tab, view]) => {
      const active = state.activeView === name;
      tab.classList.toggle("active", active);
      view.classList.toggle("active", state.appMode === "ledger" && active);
    });
  }

  function renderAppMode() {
    const receivableMode = state.appMode === "receivables";
    document.body.classList.toggle("receivable-mode", receivableMode);
    els.appTitle.textContent = receivableMode ? "売掛金メモ" : "月次帳簿ノート";
    els.receivableTotals.hidden = !receivableMode;
    if (receivableMode) renderReceivableTotals();
    els.backToLedgerButton.hidden = !receivableMode;
    els.receivablesView.classList.toggle("active", receivableMode);
    if (!receivableMode) {
      const activeView = state.activeView === "accounts" ? els.accountsView : state.activeView === "backup" ? els.backupView : els.ledgerView;
      activeView.classList.add("active");
    }
  }

  function renderLedger() {
    const locked = isLocked();
    const rows = currentRows();
    normalizeRows(rows);
    updateDatePlaceholders();
    els.lockBadge.hidden = !locked;
    els.lockedNotice.hidden = !locked;
    els.toggleLockButton.textContent = locked ? "解除" : "確定";
    els.addRowButton.disabled = locked;
    els.sortByDateButton.disabled = locked;
    els.emptyState.hidden = rows.length > 0;
    els.rowsContainer.innerHTML = rows.map((row, index) => rowTemplate(row, index, locked, rows.length)).join("");
    renderPrintRows();
  }

  function rowTemplate(row, index, locked, total) {
    return `
      <tr data-row-id="${escapeAttr(row.id)}">
        ${cellTemplate("date", row.date, locked, "")}
        ${cellTemplate("debit", row.debit, locked, "", "", "account-input")}
        ${cellTemplate("debitAmount", row.debitAmount, locked, "", "", "amount", "numeric")}
        ${cellTemplate("credit", row.credit, locked, "", "", "account-input")}
        ${cellTemplate("subAccount", row.subAccount, locked, "", "", "sub-account-input")}
        ${cellTemplate("creditAmount", row.creditAmount, locked, "", "", "amount", "numeric")}
        ${cellTemplate("summary", row.summary, locked)}
        <td class="no-print"><div class="row-actions">
          <button type="button" data-action="up" ${locked || index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" data-action="down" ${locked || index === total - 1 ? "disabled" : ""}>↓</button>
          <button type="button" data-action="delete" class="danger" ${locked ? "disabled" : ""}>×</button>
        </div></td>
      </tr>`;
  }

  function renderReceivables() {
    const rows = receivableRows();
    normalizeReceivableRows(rows);
    const selected = ensureReceivableSelectedDate();
    renderReceivableTotals();
    els.receivableMonthLabel.textContent = `${state.receivableYear}年 ${Number(state.receivableMonth)}月`;
    els.receivableCalendar.innerHTML = receivableCalendarTemplate();
    els.receivableSelectedLabel.textContent = formatReceivableDateLabel(selected);
    const dailyRows = rows.filter((row) => receivableDateKey(row.date) === selected);
    els.receivableDetailList.innerHTML = dailyRows.length
      ? dailyRows.map((row) => receivableItemTemplate(row)).join("")
      : `<p class="receivable-empty">この日の売掛メモはまだありません。</p>`;
  }

  function renderReceivableTotals() {
    const year = state.receivableYear;
    const month = state.receivableMonth;
    let monthTotal = 0;
    let yearTotal = 0;
    receivableRows().forEach((row) => {
      const parsed = parseIsoDate(receivableDateKey(row.date));
      if (!parsed || parsed.year !== year) return;
      const amount = amountNumber(row.amount);
      yearTotal += amount;
      if (parsed.month === month) monthTotal += amount;
    });
    els.receivableTotals.textContent = `月 ${monthTotal.toLocaleString("en-US")}円 / 年 ${yearTotal.toLocaleString("en-US")}円`;
  }

  function receivableCalendarTemplate() {
    const year = Number(state.receivableYear);
    const month = Number(state.receivableMonth);
    const first = new Date(year, month - 1, 1);
    const start = new Date(year, month - 1, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = isoDate(String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0"));
      const rows = receivablesForDate(key);
      const outside = date.getMonth() !== month - 1;
      const selected = key === state.receivableSelectedDate;
      const hasUnpaid = rows.some((row) => !row.paid);
      const total = rows.reduce((sum, row) => sum + amountNumber(row.amount), 0);
      const lines = total ? `<span class="receivable-day-line">${escapeHtml(total.toLocaleString("en-US"))}</span>` : "";
      const more = "";
      return `<button type="button" class="receivable-day ${outside ? "outside" : ""} ${selected ? "selected" : ""} ${hasUnpaid ? "has-unpaid" : ""}" data-date="${key}">
        <span class="receivable-day-number">${date.getDate()}</span>
        <span class="receivable-day-lines">${lines}${more}</span>
      </button>`;
    }).join("");
  }

  function receivablesForDate(dateKey) {
    return receivableRows().filter((row) => receivableDateKey(row.date) === dateKey);
  }

  function receivableItemTemplate(row) {
    return `
      <div class="receivable-item" data-row-id="${escapeAttr(row.id)}">
        <div class="receivable-item-main">
          <span class="receivable-item-client">${escapeHtml(row.client || "")}</span>
          <span class="receivable-item-amount">${escapeHtml(row.amount || "")}</span>
          <button type="button" data-action="delete" class="danger">削除</button>
        </div>
        <div class="receivable-item-detail">${escapeHtml(row.detail || "")}</div>
      </div>`;
  }

  function cellTemplate(key, value, locked, placeholder, listId, className, inputMode) {
    const list = listId ? `list="${listId}"` : "";
    const mode = inputMode ? `inputmode="${inputMode}"` : "";
    const classes = [className || ""];
    if (key === "date" && value && !normalizeDateValue(value).valid) classes.push("date-error");
    const shownPlaceholder = key === "date" ? datePlaceholder() : placeholder;
    return `<td><input data-field="${key}" class="${classes.join(" ").trim()}" type="text" value="${escapeAttr(value || "")}" placeholder="${escapeAttr(shownPlaceholder || "")}" ${list} ${mode} ${locked ? "disabled" : ""}></td>`;
  }

  function handleRowInput(event) {
    const input = event.target.closest("input[data-field]");
    if (!input || isLocked()) return;
    const row = currentRows().find((item) => item.id === input.closest("tr").dataset.rowId);
    if (!row) return;

    const field = input.dataset.field;
    const rowId = row.id;
    const value = isAmountField(field) ? formatAmount(input.value) : input.value;
    if (input.value !== value) input.value = value;
    row[field] = value;

    const changed = normalizeRows(currentRows());
    save();
    if (changed) {
      renderLedger();
      restoreFocus(rowId, field);
    } else {
      renderPrintRows();
    }
  }

  function handleReceivableInput(event) {
    const input = event.target.closest("input[data-field]");
    if (!input) return;
    const card = input.closest(".receivable-card");
    if (!card) return;
    const row = receivableRows().find((item) => item.id === card.dataset.rowId);
    if (!row) return;

    const field = input.dataset.field;
    const value = field === "paid" ? input.checked : field === "amount" ? formatAmount(input.value) : input.value;
    if (field === "amount" && input.value !== value) input.value = value;
    row[field] = value;
    save();
    if (field === "paid") {
      card.classList.toggle("paid", input.checked);
      renderReceivables();
    }
  }

  function isAmountField(field) {
    return field === "debitAmount" || field === "creditAmount";
  }

  function formatAmount(value) {
    const text = String(value).replace(/,/g, "").trim();
    if (!text) return "";
    if (!/^\d+$/.test(text)) return value;
    return Number(text).toLocaleString("en-US");
  }

  function amountNumber(value) {
    const text = String(value || "").replace(/,/g, "").trim();
    return /^\d+$/.test(text) ? Number(text) : 0;
  }

  function commitDebitAmount(input) {
    const row = currentRows().find((item) => item.id === input.closest("tr").dataset.rowId);
    if (!row) return;
    const value = formatAmount(input.value);
    input.value = value;
    row.debitAmount = value;
    if (value && !String(row.creditAmount || "").trim()) {
      row.creditAmount = value;
      const creditInput = input.closest("tr").querySelector('input[data-field="creditAmount"]');
      if (creditInput) creditInput.value = value;
    }
    save();
    renderPrintRows();
  }

  function isSuggestField(field) {
    return field === "debit" || field === "credit" || field === "subAccount";
  }

  function handleAccountSuggestFocus(event) {
    const input = event.target.closest("input[data-field]");
    if (!input || !isSuggestField(input.dataset.field) || input.disabled) return;
    showAccountSuggest(input);
  }

  function handleReceivableSuggestFocus(event) {
    const input = event.target.closest("input[data-field='client']");
    if (!input) return;
    showClientSuggest(input);
  }

  function showClientSuggest(input) {
    const candidates = recentClients();
    if (!candidates.length) {
      els.clientSuggest.hidden = true;
      return;
    }
    const card = input.closest(".receivable-card");
    els.clientSuggest.dataset.targetRow = card ? card.dataset.rowId : "";
    els.clientSuggest.dataset.target = card ? "card" : "form";
    els.clientSuggest.innerHTML = candidates.map((name) => `<button type="button" data-value="${escapeAttr(name)}">${escapeHtml(name)}</button>`).join("");
    const rect = input.getBoundingClientRect();
    els.clientSuggest.style.left = `${Math.max(4, rect.left)}px`;
    els.clientSuggest.style.top = `${rect.bottom + 2}px`;
    els.clientSuggest.style.width = `${Math.max(rect.width, 112)}px`;
    els.clientSuggest.hidden = false;
  }

  function showAccountSuggest(input) {
    const candidates = input.dataset.field === "subAccount" ? recentSubAccounts() : input.dataset.field === "client" ? recentClients() : uniqueAccounts();
    if (!candidates.length) {
      els.accountSuggest.hidden = true;
      return;
    }
    els.accountSuggest.dataset.targetRow = input.closest("tr").dataset.rowId;
    els.accountSuggest.dataset.targetField = input.dataset.field;
    els.accountSuggest.dataset.targetContainer = input.closest("tbody").id;
    els.accountSuggest.innerHTML = candidates.map((name) => `<button type="button" data-value="${escapeAttr(name)}">${escapeHtml(name)}</button>`).join("");
    const rect = input.getBoundingClientRect();
    els.accountSuggest.style.left = `${Math.max(4, rect.left)}px`;
    els.accountSuggest.style.top = `${rect.bottom + 2}px`;
    els.accountSuggest.style.width = `${Math.max(rect.width, 112)}px`;
    els.accountSuggest.hidden = false;
  }

  function chooseSuggestedAccount(event) {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    event.preventDefault();
    const rowId = els.accountSuggest.dataset.targetRow;
    const field = els.accountSuggest.dataset.targetField;
    const container = document.getElementById(els.accountSuggest.dataset.targetContainer || "rowsContainer");
    const input = container ? container.querySelector(`tr[data-row-id="${CSS.escape(rowId)}"] input[data-field="${field}"]`) : null;
    if (!input) return;
    input.value = button.dataset.value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: button.dataset.value }));
    if (field === "subAccount") rememberSubAccount(button.dataset.value);
    if (field === "client") rememberClient(button.dataset.value);
    input.focus();
    els.accountSuggest.hidden = true;
  }

  function chooseSuggestedClient(event) {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    event.preventDefault();
    const rowId = els.clientSuggest.dataset.targetRow;
    const input = els.clientSuggest.dataset.target === "form"
      ? els.receivableClientInput
      : els.receivableDetailList.querySelector(`.receivable-card[data-row-id="${CSS.escape(rowId)}"] input[data-field="client"]`);
    if (!input) return;
    input.value = button.dataset.value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: button.dataset.value }));
    rememberClient(button.dataset.value);
    input.focus();
    els.clientSuggest.hidden = true;
  }

  function hideAccountSuggestOnOutside(event) {
    if (els.accountSuggest.hidden) return;
    if (event.target.closest("#accountSuggest") || event.target.closest("input.account-input") || event.target.closest("input.sub-account-input") || event.target.closest("input.client-input")) return;
    els.accountSuggest.hidden = true;
  }

  function hideClientSuggestOnOutside(event) {
    if (els.clientSuggest.hidden) return;
    if (event.target.closest("#clientSuggest") || event.target.closest("input.client-input")) return;
    els.clientSuggest.hidden = true;
  }

  function handleCellBlur(event) {
    const debitAmountInput = event.target.closest("input[data-field='debitAmount']");
    if (debitAmountInput && !isLocked()) {
      commitDebitAmount(debitAmountInput);
      return;
    }

    const subInput = event.target.closest("input[data-field='subAccount']");
    if (subInput && !isLocked()) {
      const row = currentRows().find((item) => item.id === subInput.closest("tr").dataset.rowId);
      const trimmed = subInput.value.trim();
      if (trimmed) {
        subInput.value = trimmed;
        if (row) row.subAccount = trimmed;
        rememberSubAccount(trimmed);
        save();
      }
      return;
    }

    const input = event.target.closest("input[data-field='date']");
    if (!input || isLocked()) return;
    const result = normalizeDateValue(input.value);
    const formatted = result.value;
    input.value = formatted;
    input.classList.toggle("date-error", !result.valid);
    const row = currentRows().find((item) => item.id === input.closest("tr").dataset.rowId);
    if (!row) return;
    row.date = formatted;
    save();
    renderPrintRows();
  }

  function handleReceivableBlur(event) {
    const input = event.target.closest("input[data-field]");
    if (!input) return;
    const card = input.closest(".receivable-card");
    if (!card) return;
    const row = receivableRows().find((item) => item.id === card.dataset.rowId);
    if (!row) return;
    const field = input.dataset.field;

    if (field === "client") {
      const trimmed = input.value.trim();
      input.value = trimmed;
      row.client = trimmed;
      if (trimmed) rememberClient(trimmed);
      save();
      renderReceivables();
      return;
    }

    if (field === "amount") {
      const value = formatAmount(input.value);
      input.value = value;
      row.amount = value;
      save();
      renderReceivables();
      return;
    }

    if (field === "date" || field === "expectedDate") {
      const value = normalizeReceivableDate(input.value, field === "date" ? row.date : row.expectedDate);
      row[field] = value;
      input.value = formatReceivableInputDate(value);
      if (field === "date" && value) {
        state.receivableSelectedDate = value;
      }
      save();
      renderReceivables();
      return;
    }

    if (field !== "paid") {
      const trimmed = input.value.trim();
      input.value = trimmed;
      row[field] = trimmed;
      save();
    }
  }

  function keepFocusedRowVisible(event) {
    const input = event.target.closest("input[data-field]");
    if (!input) return;
    window.setTimeout(() => {
      input.closest("tr").scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 80);
  }

  function handleRowAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button || isLocked()) return;
    const rows = currentRows();
    const index = rows.findIndex((item) => item.id === button.closest("tr").dataset.rowId);
    if (index < 0) return;
    if (button.dataset.action === "delete") {
      if (!confirm("この行を削除しますか？")) return;
      rows.splice(index, 1);
    }
    if (button.dataset.action === "up" && index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
    if (button.dataset.action === "down" && index < rows.length - 1) [rows[index], rows[index + 1]] = [rows[index + 1], rows[index]];
    save();
    renderLedger();
  }

  function handleReceivableAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const rows = receivableRows();
    const item = button.closest(".receivable-item");
    const index = rows.findIndex((row) => item && row.id === item.dataset.rowId);
    if (index < 0) return;
    if (button.dataset.action === "delete") {
      if (!confirm("この売掛メモ行を削除しますか？")) return;
      rows.splice(index, 1);
    }
    normalizeReceivableRows(rows);
    save();
    renderReceivables();
  }

  function handleCellKeydown(event) {
    if (event.key !== "Enter") return;
    const debitAmountInput = event.target.closest("input[data-field='debitAmount']");
    if (debitAmountInput && !isLocked()) commitDebitAmount(debitAmountInput);
    const inputs = Array.from(els.rowsContainer.querySelectorAll("input[data-field]:not(:disabled)"));
    const index = inputs.indexOf(event.target);
    if (index >= 0 && inputs[index + 1]) {
      event.preventDefault();
      inputs[index + 1].focus();
      inputs[index + 1].select();
    }
  }

  function handleReceivableKeydown(event) {
    if (event.key !== "Enter") return;
    const input = event.target.closest("input[data-field]");
    if (!input) return;
    input.blur();
    const inputs = Array.from(els.receivableDetailList.querySelectorAll("input[data-field]"));
    const index = inputs.indexOf(input);
    if (index >= 0 && inputs[index + 1]) {
      event.preventDefault();
      inputs[index + 1].focus();
      if (inputs[index + 1].select) inputs[index + 1].select();
    }
  }

  function moveReceivableMonth(offset) {
    const date = new Date(Number(state.receivableYear), Number(state.receivableMonth) - 1 + offset, 1);
    state.receivableYear = String(date.getFullYear());
    state.receivableMonth = String(date.getMonth() + 1).padStart(2, "0");
    state.receivableSelectedDate = isoDate(state.receivableYear, state.receivableMonth, "01");
    renderReceivables();
  }

  function selectReceivableDate(event) {
    const button = event.target.closest("button[data-date]");
    if (!button) return;
    state.receivableSelectedDate = button.dataset.date;
    const parsed = parseIsoDate(state.receivableSelectedDate);
    if (parsed) {
      state.receivableYear = parsed.year;
      state.receivableMonth = parsed.month;
    }
    renderReceivables();
  }

  function addReceivableForSelectedDate(event) {
    event.preventDefault();
    const date = ensureReceivableSelectedDate();
    const client = els.receivableClientInput.value.trim();
    const amount = formatAmount(els.receivableAmountInput.value);
    const detail = els.receivableDetailInput.value.trim();
    if (!client && !amount && !detail) return;
    const rows = receivableRows();
    rows.push({ ...createReceivableRow(), date, client, amount, detail });
    if (client) rememberClient(client);
    normalizeReceivableRows(rows);
    save();
    els.receivableClientInput.value = "";
    els.receivableAmountInput.value = "";
    els.receivableDetailInput.value = "";
    renderReceivables();
    els.receivableClientInput.focus();
  }

  function ensureReceivableSelectedDate() {
    const parsed = parseIsoDate(state.receivableSelectedDate);
    if (parsed && parsed.year === state.receivableYear && parsed.month === state.receivableMonth) return state.receivableSelectedDate;
    state.receivableSelectedDate = isoDate(state.receivableYear, state.receivableMonth, "01");
    return state.receivableSelectedDate;
  }

  function receivableDateKey(value) {
    const normalized = normalizeReceivableDate(value, "");
    return normalized || "";
  }

  function normalizeReceivableDate(value, fallback) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const text = toHalfWidth(raw).replace(/\s+/g, "");
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const slash = text.match(/^(?:(\d{4})[\/.-])?(\d{1,2})[\/月.-](\d{1,2})日?$/);
    const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    const compactMonthDay = text.match(/^(\d{4})$/);
    const dayOnly = text.match(/^(\d{1,2})日?$/);
    const base = parseIsoDate(fallback) || { year: state.receivableYear, month: state.receivableMonth };
    let year = base.year;
    let month = base.month;
    let day = "";

    if (iso) {
      year = iso[1];
      month = iso[2];
      day = iso[3];
    } else if (slash) {
      year = slash[1] || base.year;
      month = slash[2];
      day = slash[3];
    } else if (compact) {
      year = compact[1];
      month = compact[2];
      day = compact[3];
    } else if (compactMonthDay) {
      month = compactMonthDay[1].slice(0, 2);
      day = compactMonthDay[1].slice(2, 4);
    } else if (dayOnly) {
      day = dayOnly[1];
    } else {
      return raw;
    }

    const normalized = isoDate(year, month, day);
    return isRealDate(Number(year), Number(month), Number(day)) ? normalized : raw;
  }

  function formatReceivableInputDate(value) {
    const parsed = parseIsoDate(value);
    if (!parsed) return value || "";
    return `${parsed.month}/${parsed.day}`;
  }

  function formatReceivableDateLabel(value) {
    const parsed = parseIsoDate(value);
    if (!parsed) return "--/--";
    const date = new Date(Number(parsed.year), Number(parsed.month) - 1, Number(parsed.day));
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return `${parsed.month}/${parsed.day} (${weekdays[date.getDay()]})`;
  }

  function parseIsoDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return { year: match[1], month: match[2], day: match[3] };
  }

  function isoDate(year, month, day) {
    return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
  }

  function sortDatedRowsOnly() {
    const rows = currentRows();
    const dated = rows.filter((row) => row.date.trim()).sort((a, b) => dateSortValue(a.date).localeCompare(dateSortValue(b.date), "ja"));
    let datedIndex = 0;
    rows.forEach((row, index) => { if (row.date.trim()) rows[index] = dated[datedIndex++]; });
  }

  function dateSortValue(value) {
    const text = value.trim();
    const match = text.match(/^(?:(\d{1,2})\s*[\/月.-])?\s*(\d{1,2})/);
    if (!match) return text;
    const month = match[1] || state.currentMonth;
    const day = match[2];
    return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}-${text}`;
  }

  function normalizeDateValue(value) {
    const raw = String(value).trim();
    if (!raw) return { value: "", valid: true };
    const text = toHalfWidth(raw).replace(/\s+/g, "");
    let month = "";
    let day = "";

    const compact = text.match(/^(\d{4})$/);
    const separated = text.match(/^(\d{1,2})[\/月.-](\d{1,2})日?$/);
    const dayOnly = text.match(/^(\d{1,2})日?$/);

    if (compact) {
      month = compact[1].slice(0, 2);
      day = compact[1].slice(2, 4);
    } else if (separated) {
      month = separated[1];
      day = separated[2];
    } else if (dayOnly) {
      month = state.currentMonth;
      day = dayOnly[1];
    } else {
      return { value: raw, valid: false };
    }

    const normalized = `${pad2(month)}/${pad2(day)}`;
    const valid = pad2(month) === state.currentMonth && isRealDate(Number(state.currentYear), Number(month), Number(day));
    return { value: normalized, valid };
  }

  function toHalfWidth(value) {
    return String(value).replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  }

  function isRealDate(year, month, day) {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function datePlaceholder() {
    return `${state.currentMonth}/`;
  }

  function updateDatePlaceholders() {
    els.rowsContainer.querySelectorAll('input[data-field="date"]').forEach((input) => {
      input.placeholder = datePlaceholder();
    });
  }

  function pad2(value) {
    return String(Number(value)).padStart(2, "0");
  }

  function renderAccounts() {
    const accounts = uniqueAccounts();
    els.accountsList.innerHTML = accounts.map((name) => `<li><span>${escapeHtml(name)}</span><button type="button" data-account="${escapeAttr(name)}" class="danger">削除</button></li>`).join("");
  }

  function uniqueAccounts() { return Array.from(new Set(state.data.accounts.map((name) => String(name).trim()).filter(Boolean))); }

  function recentSubAccounts() {
    if (!Array.isArray(state.data.recentSubAccounts)) state.data.recentSubAccounts = [];
    return state.data.recentSubAccounts.map((name) => String(name).trim()).filter(Boolean).slice(0, 6);
  }

  function rememberSubAccount(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return;
    const withoutDuplicate = recentSubAccounts().filter((name) => name !== trimmed);
    state.data.recentSubAccounts = [trimmed, ...withoutDuplicate].slice(0, 6);
  }

  function recentClients() {
    if (!Array.isArray(state.data.recentClients)) state.data.recentClients = [];
    return state.data.recentClients.map((name) => String(name).trim()).filter(Boolean).slice(0, 6);
  }

  function rememberClient(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return;
    const withoutDuplicate = recentClients().filter((name) => name !== trimmed);
    state.data.recentClients = [trimmed, ...withoutDuplicate].slice(0, 6);
  }

  function addAccount(event) {
    event.preventDefault();
    const value = els.accountInput.value.trim();
    if (!value) return;
    if (!state.data.accounts.includes(value)) {
      state.data.accounts.push(value);
      state.data.accounts.sort((a, b) => a.localeCompare(b, "ja"));
      save();
    }
    els.accountInput.value = "";
    renderAccounts();
  }

  function removeAccount(event) {
    const button = event.target.closest("button[data-account]");
    if (!button) return;
    if (!confirm(`${button.dataset.account} を候補から削除しますか？`)) return;
    state.data.accounts = state.data.accounts.filter((name) => name !== button.dataset.account);
    save();
    renderAccounts();
  }

  function setView(name) {
    state.appMode = "ledger";
    state.activeView = name;
    renderTabs();
    renderAppMode();
  }

  function openReceivablesMode() {
    state.appMode = "receivables";
    renderTabs();
    renderAppMode();
    renderReceivables();
  }

  function closeReceivablesMode() {
    state.appMode = "ledger";
    state.activeView = "ledger";
    renderTabs();
    renderAppMode();
  }

  function toggleLock() {
    const month = currentMonthData();
    if (month.locked) {
      if (!confirm("ロックを解除して編集できるようにしますか？")) return;
      month.locked = false;
    } else {
      if (!confirm("この月を確定済みにしてロックしますか？")) return;
      month.locked = true;
    }
    save();
    renderLedger();
  }

  function deleteCurrentMonth() {
    if (!confirm(`${monthKey()} のデータを削除しますか？`)) return;
    delete state.data.months[monthKey()];
    ensureMonth(monthKey());
    save();
    renderLedger();
  }

  function renderPrintRows() {
    els.printTitle.textContent = `${state.currentYear}年${Number(state.currentMonth)}月 月次帳簿`;
    els.printRows.innerHTML = currentRows().map((row) => `<tr>${columns.map(([key]) => `<td>${escapeHtml(row[key] || "")}</td>`).join("")}</tr>`).join("");
  }

  function downloadCsv() {
    const header = columns.map(([, label]) => label);
    const rows = currentRows().map((row) => columns.map(([key]) => row[key] || ""));
    const csv = [header, ...rows].map((line) => line.map(csvCell).join(",")).join("\r\n");
    downloadBlob("\ufeff" + csv, `${monthKey()}-ledger.csv`, "text/csv;charset=utf-8");
  }

  function csvCell(value) { return `"${String(value).replace(/"/g, '""')}"`; }
  function downloadBackup() { downloadBlob(JSON.stringify(state.data, null, 2), "ledger-backup.json", "application/json"); }

  function restoreBackup(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== "object" || !parsed.months || !Array.isArray(parsed.accounts)) throw new Error("invalid backup");
        if (!confirm("バックアップから復元します。現在の端末内データを置き換えてよいですか？")) return;
        state.data = {
          version: 3,
          accounts: parsed.accounts,
          recentSubAccounts: Array.isArray(parsed.recentSubAccounts) ? parsed.recentSubAccounts.map((name) => String(name).trim()).filter(Boolean).slice(0, 6) : [],
          recentClients: Array.isArray(parsed.recentClients) ? parsed.recentClients.map((name) => String(name).trim()).filter(Boolean).slice(0, 6) : [],
          months: parsed.months,
          receivables: parsed.receivables && typeof parsed.receivables === "object" && Array.isArray(parsed.receivables.rows) ? parsed.receivables : { rows: [] },
          lastSavedAt: new Date().toISOString()
        };
        ensureMonth(monthKey());
        ensureReceivables();
        save();
        render();
      } catch {
        alert("バックアップファイルを読み込めませんでした。");
      } finally {
        els.restoreInput.value = "";
      }
    };
    reader.readAsText(file);
  }

  function restoreFocus(rowId, field) {
    if (!window.CSS || !CSS.escape) return;
    const input = els.rowsContainer.querySelector(`tr[data-row-id="${CSS.escape(rowId)}"] input[data-field="${field}"]`);
    if (!input) return;
    input.focus();
    const length = input.value.length;
    input.setSelectionRange(length, length);
  }

  function restoreReceivableFocus(rowId, field) {
    if (!window.CSS || !CSS.escape) return;
    const input = els.receivableDetailList.querySelector(`.receivable-card[data-row-id="${CSS.escape(rowId)}"] input[data-field="${field}"]`);
    if (!input) return;
    input.focus();
    if (input.type === "text") {
      const length = input.value.length;
      input.setSelectionRange(length, length);
    }
  }

  function focusLastRow() {
    const inputs = els.rowsContainer.querySelectorAll("tr:last-child input[data-field]");
    if (inputs[0]) inputs[0].focus();
  }

  function focusLastReceivableRow() {
    const inputs = els.receivableDetailList.querySelectorAll(".receivable-card:last-child input[data-field]");
    if (inputs[0]) inputs[0].focus();
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function escapeAttr(value) { return escapeHtml(value); }
})();
















