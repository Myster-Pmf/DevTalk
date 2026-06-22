// --- DEFAULT CONFIGURATION ---

const DEFAULT_TOOLS = [
    {
        type: "function",
        function: {
            name: "get_weather",
            description: "Get current weather for a location",
            parameters: {
                type: "object",
                properties: {
                    location: { type: "string", description: "City name" },
                    unit: { type: "string", enum: ["celsius", "fahrenheit"] }
                },
                required: ["location"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "search_web",
            description: "Search for information on the internet",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query" }
                },
                required: ["query"]
            }
        }
    }
];

const DEFAULT_TOOL_CODE = `return {
    get_weather: (args) => {
        // Mock Weather Tool
        const conditions = ['Sunny', 'Cloudy', 'Rainy', 'Snowy'];
        const randomCondition = conditions[Math.floor(Math.random() * conditions.length)];
        return {
            location: args.location,
            temperature: Math.floor(Math.random() * 30) + 10,
            unit: args.unit || 'celsius',
            condition: randomCondition,
            note: "This is a simulated response from the JavaScript editor!"
        };
    },
    search_web: (args) => {
        // Mock Search Tool
        return {
            query: args.query,
            results: [
                { title: "Search Result for " + args.query, snippet: "This is a dynamic simulated result from your JS code." },
                { title: "Another Result", snippet: "You can modify this behavior in the editor." }
            ]
        };
    }
};`;

// --- STATE ---
let models = [];
let activeModelIndex = null;
let chatTabs = [];
let activeTabIndex = 0;
// Current Tools state (editable by user)
let currentTools = JSON.parse(JSON.stringify(DEFAULT_TOOLS));
// Pending images for next message (base64 data URLs)
let pendingImages = [];
const tabRuntimeState = new Map();

// --- THEME ---

/**
 * Initialize theme from localStorage on page load.
 * Defaults to 'light' if no preference is stored.
 */
function initTheme() {
    const saved = localStorage.getItem('devtalk_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcons(saved);
}

/**
 * Toggle between light and dark themes and persist to localStorage.
 */
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('devtalk_theme', next);
    updateThemeIcons(next);
}

/**
 * Show the correct sun/moon icon based on current theme.
 * In light mode → show moon icon (click to go dark).
 * In dark mode  → show sun icon (click to go light).
 */
function updateThemeIcons(theme) {
    const sun  = document.getElementById('iconSun');
    const moon = document.getElementById('iconMoon');
    if (!sun || !moon) return;
    if (theme === 'dark') {
        sun.style.display  = 'block';
        moon.style.display = 'none';
    } else {
        sun.style.display  = 'none';
        moon.style.display = 'block';
    }
}

function getTabRuntimeState(tab) {
    if (!tab) return { isGenerating: false, abortController: null };
    if (!tabRuntimeState.has(tab.id)) {
        tabRuntimeState.set(tab.id, { isGenerating: false, abortController: null });
    }
    return tabRuntimeState.get(tab.id);
}

function setTabGenerating(tab, isGenerating, abortController = null) {
    if (!tab) return;
    const runtime = getTabRuntimeState(tab);
    runtime.isGenerating = isGenerating;
    runtime.abortController = abortController;
    updateSendButtonState();
}

function updateSendButtonState() {
    const btnSend = document.getElementById('btnSend');
    const tab = chatTabs[activeTabIndex];
    const runtime = getTabRuntimeState(tab);
    if (!btnSend) return;

    if (runtime.isGenerating) {
        btnSend.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:inline;margin-right:4px;vertical-align:-2px;">
                <rect x="4" y="4" width="16" height="16" rx="2"></rect>
            </svg>
            Stop
        `;
        btnSend.classList.add('is-generating');
        btnSend.title = 'Stop generating';
    } else {
        btnSend.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:inline;margin-right:4px;vertical-align:-2px;">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
            Send
        `;
        btnSend.classList.remove('is-generating');
        btnSend.title = 'Send message';
    }
}

function cancelGeneration(index = activeTabIndex) {
    const tab = chatTabs[index];
    if (!tab) return;
    const runtime = getTabRuntimeState(tab);
    if (runtime.abortController) {
        runtime.abortController.abort();
    }
}

function isAssistantMessage(msg) {
    return msg && msg.role === 'assistant';
}

function createAssistantVersion({
    content = '',
    tool_calls = null,
    tokens = 0,
    metadata = {}
} = {}) {
    return {
        id: Date.now() + Math.random(),
        content,
        tool_calls: tool_calls || null,
        tokens,
        metadata: metadata || {}
    };
}

function ensureAssistantVersionShape(msg) {
    if (!isAssistantMessage(msg)) return msg;

    if (!Array.isArray(msg.versions) || msg.versions.length === 0) {
        msg.versions = [createAssistantVersion({
            content: msg.content || '',
            tool_calls: msg.tool_calls || null,
            tokens: msg.tokens || 0,
            metadata: msg.metadata || {}
        })];
        msg.activeVersionIndex = 0;
    }

    if (
        typeof msg.activeVersionIndex !== 'number' ||
        msg.activeVersionIndex < 0 ||
        msg.activeVersionIndex >= msg.versions.length
    ) {
        msg.activeVersionIndex = msg.versions.length - 1;
    }

    const activeVersion = msg.versions[msg.activeVersionIndex];
    msg.content = activeVersion.content;
    msg.tool_calls = activeVersion.tool_calls || null;
    msg.tokens = activeVersion.tokens || 0;
    msg.metadata = activeVersion.metadata || {};

    return msg;
}

function normalizeTabMessageShapes(tab) {
    if (!tab || !Array.isArray(tab.messages)) return;
    tab.messages = tab.messages.map(msg => ensureAssistantVersionShape(msg));
}

function getActiveAssistantVersion(msg) {
    if (!isAssistantMessage(msg)) return null;
    ensureAssistantVersionShape(msg);
    return msg.versions[msg.activeVersionIndex] || null;
}

function getAssistantVersionCount(msg) {
    if (!isAssistantMessage(msg)) return 0;
    ensureAssistantVersionShape(msg);
    return msg.versions.length;
}

function appendAssistantVersion(msg, versionData) {
    ensureAssistantVersionShape(msg);
    msg.versions.push(createAssistantVersion(versionData));
    msg.activeVersionIndex = msg.versions.length - 1;
    return ensureAssistantVersionShape(msg);
}

function upsertAssistantMessage(tab, targetIndex, versionData) {
    if (typeof targetIndex === 'number' && tab.messages[targetIndex] && isAssistantMessage(tab.messages[targetIndex])) {
        appendAssistantVersion(tab.messages[targetIndex], versionData);
        return targetIndex;
    }

    const assistantMessage = ensureAssistantVersionShape({
        role: 'assistant',
        versions: [createAssistantVersion(versionData)],
        activeVersionIndex: 0
    });

    tab.messages.push(assistantMessage);
    return tab.messages.length - 1;
}

function getProviderLabel(model) {
    const baseUrl = (model?.baseUrl || '').toLowerCase();
    if (baseUrl.includes('lightning.ai')) return 'Lightning AI';
    if (baseUrl.includes('openai.com')) return 'OpenAI-compatible';
    if (baseUrl.includes('ollama')) return 'Ollama';
    return 'Custom';
}

function buildResponseMetadata(model, requestMetrics, usage = {}) {
    const durationMs = Math.max(0, Math.round(performance.now() - requestMetrics.startedPerf));
    const completionTokens = usage.completion_tokens ?? null;
    const promptTokens = usage.prompt_tokens ?? null;
    const totalTokens = usage.total_tokens ?? null;
    const tokensPerSecond = (completionTokens && durationMs > 0)
        ? Number((completionTokens / (durationMs / 1000)).toFixed(2))
        : null;

    return {
        modelName: model.name,
        baseUrl: model.baseUrl,
        provider: getProviderLabel(model),
        streamed: !!requestMetrics.streamed,
        startedAt: requestMetrics.startedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        promptTokens,
        completionTokens,
        totalTokens,
        tokensPerSecond
    };
}

function formatDuration(durationMs) {
    if (durationMs === null || durationMs === undefined) return 'n/a';
    if (durationMs < 1000) return `${durationMs} ms`;
    return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatNumericMetric(value, suffix = '') {
    if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
    return `${Number(value).toLocaleString()}${suffix}`;
}

function renderMessageDetails(msg) {
    if (!isAssistantMessage(msg)) return '';

    const activeVersion = getActiveAssistantVersion(msg);
    const metadata = activeVersion?.metadata || msg.metadata;
    if (!metadata || !msg.showDetails) return '';

    const metrics = [
        { label: 'Model', value: metadata.modelName || 'n/a' },
        { label: 'Provider', value: metadata.provider || 'n/a' },
        { label: 'Endpoint', value: metadata.baseUrl || 'n/a' },
        { label: 'Started', value: metadata.startedAt ? new Date(metadata.startedAt).toLocaleString() : 'n/a' },
        { label: 'Duration', value: formatDuration(metadata.durationMs) },
        { label: 'Prompt Tokens', value: formatNumericMetric(metadata.promptTokens) },
        { label: 'Completion Tokens', value: formatNumericMetric(metadata.completionTokens) },
        { label: 'Total Tokens', value: formatNumericMetric(metadata.totalTokens) },
        { label: 'Tokens / Sec', value: formatNumericMetric(metadata.tokensPerSecond) },
        { label: 'Streaming', value: metadata.streamed ? 'Yes' : 'No' }
    ];

    return `
        <div class="message-details">
            ${metrics.map(metric => `
                <div class="message-detail-row">
                    <span class="message-detail-label">${escapeHtml(metric.label)}</span>
                    <span class="message-detail-value">${escapeHtml(metric.value)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

// --- DOM ELEMENTS ---
const els = {
    apiKey: document.getElementById('apiKey'),
    modelName: document.getElementById('modelName'),
    baseUrl: document.getElementById('baseUrl'),
    temperature: document.getElementById('temperature'),
    maxTokens: document.getElementById('maxTokens'),
    userInput: document.getElementById('userInput'),
    modelList: document.getElementById('modelList'),
    tabs: document.getElementById('tabs'),
    messages: document.getElementById('messages'),
    status: document.getElementById('status'),
    btnSend: document.getElementById('btnSend'),
    toolsEditor: document.getElementById('toolsEditor'),
    enableTools: document.getElementById('enableTools'),
    // Note: systemPrompt is now looked up dynamically or by ID if consistent, but we use tab.systemPrompt mostly.
    // Re-getting it here to be safe as we moved it.
    systemPrompt: document.getElementById('systemPrompt')
};

// --- INITIALIZATION ---
function init() {
    loadFromStorage();

    // Set initial tool JSON in the editor
    if (!els.toolsEditor.value) {
        els.toolsEditor.value = JSON.stringify(currentTools, null, 2);
    }

    // Set initial tool CODE in the editor if empty
    const codeEditor = document.getElementById('toolCodeEditor');
    if (codeEditor && !codeEditor.value.trim()) {
        codeEditor.value = DEFAULT_TOOL_CODE;
    }

    // Event Listeners
    document.getElementById('btnAddModel').onclick = saveModel;
    document.getElementById('btnUpdateModel').onclick = updateModel;
    document.getElementById('btnSend').onclick = handleSendButtonClick;
    document.getElementById('btnClear').onclick = () => {
        showConfirmModal(
            "Clear Chat History?",
            "This will delete all messages in this tab and reset token usage.",
            "Clear",
            () => {
                clearChat();
            }
        );
    };
    document.getElementById('btnExport').onclick = exportChat;
    document.getElementById('toggleApiKey').onclick = toggleApiKey;
    document.getElementById('btnResetTools').onclick = resetTools;
    document.getElementById('btnFormatTools').onclick = formatTools;
    document.getElementById('importFile').onchange = importChat;

    // Image Upload Events
    document.getElementById('btnAttachImage').onclick = () => document.getElementById('imageInput').click();
    document.getElementById('imageInput').onchange = handleImageSelect;

    // Model Export/Import
    document.getElementById('btnExportModels').onclick = exportModels;
    document.getElementById('btnImportModels').onclick = () => document.getElementById('importModelsFile').click();
    document.getElementById('importModelsFile').onchange = handleModelImport;

    // Modal Events
    document.getElementById('modalBtnCancel').onclick = closeModal;
    document.getElementById('modalBtnConfirm').onclick = () => {
        if (modalConfirmCallback) modalConfirmCallback();
        closeModal();
    };

    if (els.systemPrompt) {
        els.systemPrompt.addEventListener('input', () => {
            if (chatTabs[activeTabIndex]) {
                chatTabs[activeTabIndex].systemPrompt = els.systemPrompt.value;
                saveToStorage();
                updateGeneratedCode();
                updateTokenHistoryEstimate();
            }
        });
    }

    // Enter to send
    els.userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const runtime = getTabRuntimeState(chatTabs[activeTabIndex]);
            if (!runtime.isGenerating) {
                sendMessage();
            }
        }
    });

    // Init UI
    if (chatTabs.length === 0) createNewTab();
    else {
        renderTabs();
        // Fix for potential model desync on load
        if (chatTabs[activeTabIndex].modelIndex !== null && models[chatTabs[activeTabIndex].modelIndex]) {
            activeModelIndex = chatTabs[activeTabIndex].modelIndex;
        }
        switchTab(activeTabIndex);
    }

    renderModels();

    // Code Generator Events
    document.getElementById('codeGenLang').onchange = updateGeneratedCode;
    document.getElementById('toolCodeEditor').addEventListener('input', updateGeneratedCode);
    els.toolsEditor.addEventListener('input', updateGeneratedCode);
    els.enableTools.onchange = updateGeneratedCode;

    // Model Parameter Real-time Updates (for cURL preview)
    els.modelName.addEventListener('input', updateGeneratedCode);
    els.baseUrl.addEventListener('input', updateGeneratedCode);
    els.temperature.addEventListener('input', updateGeneratedCode);
    els.maxTokens.addEventListener('input', updateGeneratedCode);
    els.apiKey.addEventListener('input', updateGeneratedCode);

    // Markdown Toggle Event
    document.getElementById('enableMarkdown').onchange = () => {
        saveToStorage();
        renderMessages();
    };

    // Proxy Settings Events
    document.getElementById('enableProxy').onchange = () => {
        saveToStorage();
        updateGeneratedCode();
    };
    document.getElementById('skipProxyForLocal').onchange = () => {
        saveToStorage();
    };

    // Mobile Sidebar Toggles
    document.getElementById('btnToggleLeft').onclick = () => toggleSidebar('left');
    document.getElementById('btnToggleRight').onclick = () => toggleSidebar('right');
    document.getElementById('sidePaneOverlay').onclick = closeAllSidebars;

    // Theme Toggle
    const btnTheme = document.getElementById('btnToggleTheme');
    if (btnTheme) btnTheme.onclick = toggleTheme;
    initTheme();

    // Copy generated code
    document.getElementById('btnCopyGenCode').onclick = () => {
        const output = document.getElementById('codeOutput');
        output.select();
        document.execCommand('copy');
        showStatus('Copied to clipboard!', '');
        setTimeout(hideStatus, 2000);
    };

    // Initial code gen
    updateGeneratedCode();
    updateSendButtonState();
}

function toggleSidebar(side) {
    const left = document.getElementById('leftPanel');
    const right = document.getElementById('rightPanel');
    const overlay = document.getElementById('sidePaneOverlay');

    if (side === 'left') {
        left.classList.toggle('open');
        right.classList.remove('open');
    } else {
        right.classList.toggle('open');
        left.classList.remove('open');
    }

    const isAnyOpen = left.classList.contains('open') || right.classList.contains('open');
    overlay.style.display = isAnyOpen ? 'block' : 'none';
}

function handleSendButtonClick() {
    const tab = chatTabs[activeTabIndex];
    const runtime = getTabRuntimeState(tab);
    if (runtime.isGenerating) {
        cancelGeneration(activeTabIndex);
        return;
    }
    sendMessage();
}

function closeAllSidebars() {
    document.getElementById('leftPanel').classList.remove('open');
    document.getElementById('rightPanel').classList.remove('open');
    document.getElementById('sidePaneOverlay').style.display = 'none';
}

// --- STATE MANAGEMENT ---

function loadFromStorage() {
    const stored = localStorage.getItem('chatPlayground_v3');
    if (stored) {
        try {
            const data = JSON.parse(stored);
            models = data.models || [];
            activeModelIndex = data.activeModelIndex;
            chatTabs = data.chatTabs || [];
            chatTabs.forEach(normalizeTabMessageShapes);
            activeTabIndex = data.activeTabIndex || 0;
            if (data.tools) {
                currentTools = data.tools;
                els.toolsEditor.value = JSON.stringify(currentTools, null, 2);
            }
            if (data.toolCode) {
                document.getElementById('toolCodeEditor').value = data.toolCode;
            }
            if (data.enableMarkdown !== undefined) {
                document.getElementById('enableMarkdown').checked = data.enableMarkdown;
            }
            if (data.enableStreaming !== undefined) {
                document.getElementById('enableStreaming').checked = data.enableStreaming;
            }
            // Proxy settings (default to true if not set)
            if (data.enableProxy !== undefined) {
                document.getElementById('enableProxy').checked = data.enableProxy;
            }
            if (data.skipProxyForLocal !== undefined) {
                document.getElementById('skipProxyForLocal').checked = data.skipProxyForLocal;
            }
        } catch (e) { console.error("Storage Error", e); }
    }
}

function saveToStorage() {
    // Update tools from editor before saving state
    try {
        currentTools = JSON.parse(els.toolsEditor.value);
    } catch (e) { }

    const toolCode = document.getElementById('toolCodeEditor').value;
    const enableMarkdown = document.getElementById('enableMarkdown').checked;
    const enableStreaming = document.getElementById('enableStreaming').checked;
    const enableProxy = document.getElementById('enableProxy').checked;
    const skipProxyForLocal = document.getElementById('skipProxyForLocal').checked;

    localStorage.setItem('chatPlayground_v3', JSON.stringify({
        models,
        activeModelIndex,
        chatTabs,
        activeTabIndex,
        tools: currentTools,
        toolCode: toolCode,
        enableMarkdown: enableMarkdown,
        enableStreaming: enableStreaming,
        enableProxy: enableProxy,
        skipProxyForLocal: skipProxyForLocal
    }));
}

// --- MODEL LOGIC ---

function getModelFromUI() {
    return {
        apiKey: els.apiKey.value.trim(),
        name: els.modelName.value.trim(),
        baseUrl: els.baseUrl.value.trim(),
        temperature: parseFloat(els.temperature.value),
        maxTokens: parseInt(els.maxTokens.value),
        isVision: document.getElementById('isVisionModel').checked
    };
}

function loadModelToUI(model) {
    if (!model) return;
    els.apiKey.value = model.apiKey || '';
    els.modelName.value = model.name || '';
    els.baseUrl.value = model.baseUrl || '';
    els.temperature.value = model.temperature || 0.7;
    els.maxTokens.value = model.maxTokens || 2048;
    document.getElementById('isVisionModel').checked = model.isVision || false;
}

function saveModel() {
    const model = getModelFromUI();
    if (!model.name) return showStatus('Name required', 'error');
    models.push(model);
    activeModelIndex = models.length - 1;

    // Sync new model with current tab
    if (chatTabs[activeTabIndex]) {
        chatTabs[activeTabIndex].modelIndex = activeModelIndex;
    }

    saveToStorage();
    renderModels();
    renderTabs();
    showStatus('Model Saved', '');
    setTimeout(hideStatus, 2000);
}

function updateModel() {
    if (activeModelIndex === null) return;
    models[activeModelIndex] = getModelFromUI();
    saveToStorage();
    renderModels();
    renderTabs(); // Refresh names on tabs
    updateGeneratedCode(); // NEW: update on model change
    showStatus('Model Updated', '');
    setTimeout(hideStatus, 2000);
}

function deleteModel(index, e) {
    if (e) e.stopPropagation();
    models.splice(index, 1);
    if (activeModelIndex === index) activeModelIndex = null;
    else if (activeModelIndex > index) activeModelIndex--;

    // Remove model ref from tabs
    chatTabs.forEach(t => { if (t.modelIndex === index) t.modelIndex = null; });

    saveToStorage();
    renderModels();
    if (activeModelIndex !== null) loadModelToUI(models[activeModelIndex]);
    else {
        els.apiKey.value = '';
        els.modelName.value = '';
        els.baseUrl.value = '';
    }
}

function selectModel(index) {
    activeModelIndex = index;
    loadModelToUI(models[index]);
    if (chatTabs[activeTabIndex]) {
        chatTabs[activeTabIndex].modelIndex = index;
    }
    saveToStorage();
    renderModels();
    renderTabs();
    updateGeneratedCode(); // NEW: update on select
}

function renderModels() {
    els.modelList.innerHTML = models.map((m, i) => `
        <div class="model-item ${i === activeModelIndex ? 'active' : ''}" onclick="selectModel(${i})">
            <div>
                <div class="model-name">${escapeHtml(m.name)}</div>
                <div class="model-url">${escapeHtml(m.baseUrl)}</div>
            </div>
            <button class="icon-btn delete-model-btn" onclick="deleteModel(${i}, event)" title="Delete Model">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cc3333" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        </div>
    `).join('');
}

// --- MODEL IMPORT / EXPORT ---

function exportModels() {
    if (models.length === 0) return showStatus('No models to export', 'error');

    const data = JSON.stringify(models, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `models_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus('Models exported', '');
    setTimeout(hideStatus, 2000);
}

function handleModelImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedModels = JSON.parse(event.target.result);
            if (!Array.isArray(importedModels)) {
                throw new Error("Invalid format: expected an array of models.");
            }
            importModels(importedModels);
        } catch (err) {
            showStatus('Import Error: ' + err.message, 'error');
        }
        e.target.value = ''; // Reset file input
    };
    reader.readAsText(file);
}

function importModels(newModels) {
    let addedCount = 0;
    let skippedCount = 0;

    newModels.forEach(newM => {
        // Smart check: Avoid duplicate if name AND apiKey match exactly
        const isDuplicate = models.some(existing =>
            existing.name === newM.name &&
            existing.apiKey === newM.apiKey
        );

        if (!isDuplicate) {
            // Basic validation: ensure it has a name
            if (newM.name) {
                models.push(newM);
                addedCount++;
            } else {
                skippedCount++;
            }
        } else {
            skippedCount++;
        }
    });

    if (addedCount > 0) {
        // If no model was active, select the first newly added one
        if (activeModelIndex === null && models.length > 0) {
            selectModel(models.length - addedCount);
        } else {
            saveToStorage();
            renderModels();
        }
        showStatus(`Imported ${addedCount} models. Skipped ${skippedCount}.`, '');
    } else {
        showStatus(`No new models added. Skipped ${skippedCount} duplicates/invalid.`, 'error');
    }
    setTimeout(hideStatus, 3000);
}

// --- TAB LOGIC ---

function createNewTab() {
    // Determine the best model to inherit
    let inheritModelIndex = activeModelIndex;

    // Validate the inherited index
    if (inheritModelIndex !== null && !models[inheritModelIndex]) {
        inheritModelIndex = null;
    }

    // If still null but models exist, maybe default to 0? 
    // User asked "default selected", usually implies preserving state, or picking first if fresh.
    if (inheritModelIndex === null && models.length > 0) {
        inheritModelIndex = 0;
    }

    chatTabs.push({
        id: Date.now(),
        messages: [],
        modelIndex: inheritModelIndex,
        systemPrompt: "You are a helpful assistant.",
        tokenUsage: 0
    });
    activeTabIndex = chatTabs.length - 1;
    saveToStorage();
    renderTabs();
    switchTab(activeTabIndex);
}

function switchTab(index) {
    activeTabIndex = index;
    const tab = chatTabs[index];
    normalizeTabMessageShapes(tab);

    // 1. Load System Prompt specific to this tab
    if (els.systemPrompt) els.systemPrompt.value = tab.systemPrompt || '';

    // 2. Sync Model UI
    if (tab.modelIndex !== null && models[tab.modelIndex]) {
        activeModelIndex = tab.modelIndex;
        loadModelToUI(models[tab.modelIndex]);
    } else {
        activeModelIndex = null;
    }
    renderModels();

    // 3. Update Token Usage Display
    const tokenDisplay = document.getElementById('tokenUsage');
    if (tokenDisplay) {
        tokenDisplay.textContent = tab.tokenUsage || 0;
    }

    renderTabs();
    renderMessages();
    updateGeneratedCode(); // NEW: update on tab switch
    updateSendButtonState();
}

function closeTab(index, e) {
    e.stopPropagation();
    if (chatTabs.length <= 1) return; // Keep at least one
    cancelGeneration(index);
    tabRuntimeState.delete(chatTabs[index]?.id);

    chatTabs.splice(index, 1);
    if (activeTabIndex >= chatTabs.length) activeTabIndex = chatTabs.length - 1;

    saveToStorage();
    switchTab(activeTabIndex);
}

function startRenameTab(index, e) {
    e.preventDefault(); // Prevent context menu
    const tabEl = e.currentTarget;
    const nameSpan = tabEl.querySelector('.tab-name-span');
    if (!nameSpan) return;

    const currentName = chatTabs[index].customName || `Tab ${index + 1}`;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'tab-edit-input';

    input.onblur = () => finishRenameTab(index, input.value);
    input.onkeydown = (ev) => {
        if (ev.key === 'Enter') finishRenameTab(index, input.value);
        e.stopPropagation();
    };

    nameSpan.style.display = 'none';
    nameSpan.parentNode.insertBefore(input, nameSpan);
    input.focus();
}

function finishRenameTab(index, newName) {
    if (newName && newName.trim()) {
        chatTabs[index].customName = newName.trim();
    }
    saveToStorage();
    renderTabs();
}

function renderTabs() {
    els.tabs.innerHTML = chatTabs.map((tab, i) => {
        // Safe check for model existence
        const mName = (tab.modelIndex !== null && models[tab.modelIndex])
            ? models[tab.modelIndex].name
            : 'No Model';

        // Use custom name if exists, else generic
        const displayName = tab.customName || `Tab ${i + 1}: ${mName.substring(0, 15)}...`;

        // We attach contextmenu event dynamically or inline
        return `
            <div class="tab ${i === activeTabIndex ? 'active' : ''}"
                 onclick="switchTab(${i})"
                 oncontextmenu="startRenameTab(${i}, event)">
                <span class="tab-name-span">${escapeHtml(displayName)}</span>
                <span class="tab-close" onclick="closeTab(${i}, event)">×</span>
            </div>
        `;
    }).join('') + `<button class="tab" onclick="createNewTab()" style="min-width:40px;">+</button>`;
}

// --- CHAT & PROXY LOGIC ---

// Helper to prepare URL
function normalizeUrl(baseUrl) {
    let cleaned = baseUrl.trim().replace(/\/+$/, "");
    if (cleaned.endsWith('/v1')) {
        return `${cleaned}/chat/completions`;
    }
    return cleaned;
}

// Helper to detect local URLs (localhost, 127.0.0.1, local network)
function isLocalUrl(url) {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        return (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '::1' ||
            hostname.endsWith('.local') ||
            hostname.endsWith('.localhost') ||
            /^192\.168\.\d+\.\d+$/.test(hostname) ||
            /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
            /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname)
        );
    } catch {
        return false;
    }
}

// Helper to determine if proxy should be used for a given URL
function shouldUseProxy(url) {
    const enableProxy = document.getElementById('enableProxy').checked;
    const skipProxyForLocal = document.getElementById('skipProxyForLocal').checked;

    // If proxy is disabled, never use it
    if (!enableProxy) {
        return false;
    }

    // If skip for local is enabled and URL is local, skip proxy
    if (skipProxyForLocal && isLocalUrl(url)) {
        return false;
    }

    return true;
}

// Helper to strip extra fields (like 'tokens') before sending to AI providers
// isOllama: if true, use Ollama's image format (separate images array)
// isVisionModel: if false, strip images and flatten array content to text
function prepareCleanMessages(messages, isOllama = false, isVisionModel = true) {
    return messages.map(m => {
        if (isAssistantMessage(m)) {
            ensureAssistantVersionShape(m);
        }

        const cleanMsg = { role: m.role };

        // Handle content (can be string or array with images)
        if (Array.isArray(m.content)) {
            // Extract text from both OpenAI and Gemini formats
            const textParts = [];
            let userImageCount = 0;
            let generatedImageCount = 0;

            for (const part of m.content) {
                // OpenAI format: { type: 'text', text: '...' }
                if (part.type === 'text' && part.text) {
                    textParts.push(part.text);
                }
                // Gemini native format: { text: '...' }
                else if (part.text && !part.type) {
                    textParts.push(part.text);
                }
                // User-uploaded image (image_url)
                else if (part.type === 'image_url') {
                    userImageCount++;
                }
                // Generated image (inline_data)
                else if (part.inline_data) {
                    generatedImageCount++;
                }
            }

            if (!isVisionModel) {
                // Non-vision model: flatten to text, add placeholder for images
                let content = textParts.join('\n') || '';
                const totalImages = userImageCount + generatedImageCount;
                if (totalImages > 0) {
                    const imagePlaceholder = totalImages === 1
                        ? '[An image was shared but this model cannot view images]'
                        : `[${totalImages} images were shared but this model cannot view images]`;
                    content = content ? `${content}\n\n${imagePlaceholder}` : imagePlaceholder;
                }
                cleanMsg.content = content;
            } else if (isOllama) {
                // Ollama format: content is string, images are separate base64 array
                cleanMsg.content = textParts.join('\n') || '';

                const imageParts = m.content.filter(p => p.type === 'image_url' && p.image_url?.url);
                if (imageParts.length > 0) {
                    cleanMsg.images = imageParts.map(p => {
                        // Extract base64 data from data URL
                        const url = p.image_url.url;
                        const base64Match = url.match(/^data:image\/[^;]+;base64,(.+)$/);
                        return base64Match ? base64Match[1] : url;
                    });
                }
                // Note: Generated images (inline_data) are NOT sent back to Ollama
            } else {
                // OpenAI vision format: filter out generated images (inline_data) 
                // Only keep text and user-uploaded images
                const filteredContent = m.content.filter(part => {
                    // Keep text parts
                    if (part.type === 'text' || (part.text && !part.type)) return true;
                    // Keep user-uploaded images
                    if (part.type === 'image_url') return true;
                    // Skip generated images (inline_data)
                    return false;
                });

                // If only generated images were present, convert to text placeholder
                if (filteredContent.length === 0 && generatedImageCount > 0) {
                    cleanMsg.content = `[Generated ${generatedImageCount} image(s)]`;
                } else if (filteredContent.length === 1 && typeof filteredContent[0].text === 'string') {
                    // Simplify if only text remains
                    cleanMsg.content = filteredContent[0].text;
                } else {
                    cleanMsg.content = filteredContent;
                }
            }
        } else {
            cleanMsg.content = m.content || '';
        }

        if (m.tool_calls) cleanMsg.tool_calls = m.tool_calls;
        if (m.tool_call_id) cleanMsg.tool_call_id = m.tool_call_id;
        return cleanMsg;
    });
}

async function sendMessage(isRegen = false, regenTargetIndex = null) {
    const tab = chatTabs[activeTabIndex];
    if (!tab || tab.modelIndex === null) return showStatus('Select a model', 'error');
    const runtime = getTabRuntimeState(tab);
    if (runtime.isGenerating) return;

    // 1. Add User Message to UI (Skip if regenerating)
    if (isRegen !== true) {
        const textContent = els.userInput.value.trim();
        // Format content with images if any are pending
        const messageContent = formatMessageContent(textContent, pendingImages);
        tab.messages.push({ role: 'user', content: messageContent });
        els.userInput.value = '';
        clearPendingImages();
        renderMessages();
        updateGeneratedCode();
    }

    const model = models[tab.modelIndex];

    if (els.apiKey.value.trim() !== model.apiKey) {
        if (!isRegen) {
            if (confirm("API Key in input differs from saved model. Update model?")) {
                updateModel();
            } else { return; }
        }
    }
    // 2. Prepare Payload
    const endpointUrl = normalizeUrl(model.baseUrl.trim());

    // Detect if this is an Ollama endpoint (not ending with /v1)
    const isOllama = !model.baseUrl.trim().replace(/\/+$/, '').endsWith('/v1');

    // Detect if this is a Lightning.ai endpoint (uses max_completion_tokens instead of max_tokens)
    const isLightningAI = model.baseUrl.toLowerCase().includes('lightning.ai');

    // Use the per-model vision setting
    const isVisionModel = model.isVision || false;

    const historySource = (isRegen === true && regenTargetIndex !== null)
        ? tab.messages.slice(0, regenTargetIndex)
        : tab.messages;
    const history = prepareCleanMessages(historySource, isOllama, isVisionModel);
    const apiMessages = [];
    if (tab.systemPrompt) apiMessages.push({ role: 'system', content: tab.systemPrompt });
    apiMessages.push(...history);

    const enableStreaming = document.getElementById('enableStreaming').checked;

    const requestBody = {
        model: model.name,
        messages: apiMessages,
        temperature: model.temperature,
        stream: enableStreaming
    };

    // Lightning.ai uses max_completion_tokens, others use max_tokens
    if (isLightningAI) {
        requestBody.max_completion_tokens = model.maxTokens;
    } else {
        requestBody.max_tokens = model.maxTokens;
    }

    // 3. Add Tools if enabled
    if (els.enableTools.checked) {
        try {
            const toolsJson = JSON.parse(els.toolsEditor.value);
            requestBody.tools = toolsJson;
            requestBody.tool_choice = "auto";
        } catch (e) {
            showStatus('Error in Tools JSON', 'error');
            return;
        }
    }

    const requestMetrics = {
        startedAt: new Date().toISOString(),
        startedPerf: performance.now(),
        streamed: enableStreaming
    };
    const abortController = new AbortController();
    setTabGenerating(tab, true, abortController);

    try {
        if (enableStreaming) {
            // --- STREAMING MODE ---
            await handleStreamingResponse(tab, model, endpointUrl, requestBody, regenTargetIndex, requestMetrics, abortController.signal);
        } else {
            // --- NON-STREAMING MODE ---
            await handleNonStreamingResponse(tab, model, endpointUrl, requestBody, regenTargetIndex, requestMetrics, abortController.signal);
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            hideStatus();
        } else {
            showStatus(`Error: ${error.message}`, 'error');
        }
        console.error(error);
    } finally {
        setTabGenerating(tab, false, null);
    }
}

// --- NON-STREAMING RESPONSE HANDLER ---
async function handleNonStreamingResponse(tab, model, endpointUrl, requestBody, regenTargetIndex = null, requestMetrics = null, signal = null) {
    let response;

    if (shouldUseProxy(endpointUrl)) {
        // Use server-side proxy
        response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
                targetUrl: endpointUrl,
                apiKey: model.apiKey.trim(),
                body: requestBody
            })
        });
    } else {
        // Direct API call (no proxy)
        const headers = { 'Content-Type': 'application/json' };
        if (model.apiKey.trim()) {
            headers['Authorization'] = `Bearer ${model.apiKey.trim()}`;
        }
        response = await fetch(endpointUrl, {
            method: 'POST',
            headers: headers,
            signal,
            body: JSON.stringify(requestBody)
        });
    }

    const responseText = await response.text();
    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        throw new Error(responseText || `HTTP ${response.status}`);
    }

    if (!response.ok) {
        // Handle rate limit errors specifically
        if (response.status === 429) {
            throw new Error('Rate limited! Please wait before sending another request.');
        }
        // Extract error message from various API formats
        const errorMsg = data.error?.message || data.error || data.message || `HTTP ${response.status}`;
        throw new Error(errorMsg);
    }

    // Handle OpenAI, Ollama, or Gemini native format
    let assistantMessage;
    let usage;

    if (data.choices && data.choices[0] && data.choices[0].message) {
        // OpenAI-compatible format
        assistantMessage = data.choices[0].message;
        usage = data.usage;
    } else if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        // Gemini native format - convert parts to compatible format
        const parts = data.candidates[0].content.parts || [];
        assistantMessage = {
            role: 'assistant',
            content: parts // Store parts array directly for multimodal support
        };
        usage = data.usageMetadata ? {
            total_tokens: (data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0),
            prompt_tokens: data.usageMetadata.promptTokenCount || 0,
            completion_tokens: data.usageMetadata.candidatesTokenCount || 0
        } : null;
    } else if (data.message) {
        // Ollama format
        assistantMessage = data.message;
        usage = {
            total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
            prompt_tokens: data.prompt_eval_count || 0,
            completion_tokens: data.eval_count || 0
        };
    } else {
        throw new Error("Unknown response format from API");
    }

    // Update token usage
    if (usage && usage.total_tokens) {
        tab.tokenUsage = (tab.tokenUsage || 0) + usage.total_tokens;
        const tokenDisplay = document.getElementById('tokenUsage');
        if (tokenDisplay) tokenDisplay.textContent = tab.tokenUsage;

        if (usage.prompt_tokens) {
            for (let i = tab.messages.length - 1; i >= 0; i--) {
                if (tab.messages[i].role === 'user') {
                    tab.messages[i].tokens = usage.prompt_tokens;
                    break;
                }
            }
        }
    }

    // Handle tool calls or regular response
    if (assistantMessage.tool_calls) {
        const responseMetadata = buildResponseMetadata(model, requestMetrics || {
            startedAt: new Date().toISOString(),
            startedPerf: performance.now(),
            streamed: false
        }, usage || {});
        upsertAssistantMessage(tab, regenTargetIndex, {
            content: assistantMessage.content || '',
            tool_calls: assistantMessage.tool_calls,
            tokens: usage?.completion_tokens || 0,
            metadata: responseMetadata
        });
        renderMessages();

        for (const toolCall of assistantMessage.tool_calls) {
            const toolResult = simulateTool(toolCall);
            tab.messages.push({
                role: 'tool',
                content: JSON.stringify(toolResult),
                tool_call_id: toolCall.id
            });
        }
        saveToStorage();
        renderMessages();
        hideStatus();
    } else {
        const responseMetadata = buildResponseMetadata(model, requestMetrics || {
            startedAt: new Date().toISOString(),
            startedPerf: performance.now(),
            streamed: false
        }, usage || {});
        upsertAssistantMessage(tab, regenTargetIndex, {
            content: assistantMessage.content,
            tokens: usage?.completion_tokens || 0,
            metadata: responseMetadata
        });
        saveToStorage();
        renderMessages();
        updateGeneratedCode();
        hideStatus();
    }
}

// --- STREAMING RESPONSE HANDLER ---
async function handleStreamingResponse(tab, model, endpointUrl, requestBody, regenTargetIndex = null, requestMetrics = null, signal = null) {
    let response;

    if (shouldUseProxy(endpointUrl)) {
        // Use server-side proxy for streaming
        response = await fetch('/api/proxy-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
                targetUrl: endpointUrl,
                apiKey: model.apiKey.trim(),
                body: requestBody
            })
        });
    } else {
        // Direct streaming API call (no proxy)
        const headers = { 'Content-Type': 'application/json' };
        if (model.apiKey.trim()) {
            headers['Authorization'] = `Bearer ${model.apiKey.trim()}`;
        }
        response = await fetch(endpointUrl, {
            method: 'POST',
            headers: headers,
            signal,
            body: JSON.stringify(requestBody)
        });
    }

    if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429) {
            throw new Error('Rate limited! Please wait before sending another request.');
        }
        // Try to parse error JSON
        try {
            const errData = JSON.parse(errorText);
            throw new Error(errData.error?.message || errData.error || errData.message || errorText);
        } catch (e) {
            throw new Error(errorText || `HTTP ${response.status}`);
        }
    }

    let streamUsage = {
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null
    };
    let streamUsageApplied = false;

    // Create placeholder message for streaming
    const msgIndex = upsertAssistantMessage(tab, regenTargetIndex, {
        content: '',
        metadata: {
            modelName: model.name,
            baseUrl: model.baseUrl,
            provider: getProviderLabel(model),
            streamed: true,
            startedAt: requestMetrics?.startedAt || new Date().toISOString()
        }
    });
    renderMessages();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) continue;

                // Try parsing as OpenAI SSE format (data: {...})
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const chunk = JSON.parse(jsonStr);
                        const delta = chunk.choices?.[0]?.delta?.content;
                        if (delta) {
                            const activeVersion = getActiveAssistantVersion(tab.messages[msgIndex]);
                            if (activeVersion) {
                                activeVersion.content += delta;
                                ensureAssistantVersionShape(tab.messages[msgIndex]);
                                renderSingleMessage(msgIndex);
                            }
                        }
                        if (chunk.usage) {
                            streamUsage = {
                                prompt_tokens: chunk.usage.prompt_tokens ?? null,
                                completion_tokens: chunk.usage.completion_tokens ?? null,
                                total_tokens: chunk.usage.total_tokens ?? null
                            };
                        }
                    } catch (e) {
                        console.warn('Failed to parse OpenAI chunk:', e);
                    }
                } else {
                    // Try parsing as Ollama NDJSON format
                    try {
                        const chunk = JSON.parse(line);
                        if (chunk.message?.content) {
                            const activeVersion = getActiveAssistantVersion(tab.messages[msgIndex]);
                            if (activeVersion) {
                                activeVersion.content += chunk.message.content;
                                ensureAssistantVersionShape(tab.messages[msgIndex]);
                                renderSingleMessage(msgIndex);
                            }
                        }
                        // Handle done state for token counts
                        if (chunk.done && chunk.eval_count) {
                            streamUsage = {
                                prompt_tokens: chunk.prompt_eval_count || 0,
                                completion_tokens: chunk.eval_count || 0,
                                total_tokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0)
                            };
                            const activeVersion = getActiveAssistantVersion(tab.messages[msgIndex]);
                            if (activeVersion) {
                                activeVersion.tokens = chunk.eval_count;
                                ensureAssistantVersionShape(tab.messages[msgIndex]);
                            }
                            tab.tokenUsage = (tab.tokenUsage || 0) +
                                (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0);
                            const tokenDisplay = document.getElementById('tokenUsage');
                            if (tokenDisplay) tokenDisplay.textContent = tab.tokenUsage;
                            streamUsageApplied = true;
                        }
                    } catch (e) {
                        // Not valid JSON, skip
                        console.warn('Failed to parse Ollama chunk:', line);
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    const finalVersion = getActiveAssistantVersion(tab.messages[msgIndex]);
    if (finalVersion) {
        finalVersion.metadata = buildResponseMetadata(model, requestMetrics || {
            startedAt: new Date().toISOString(),
            startedPerf: performance.now(),
            streamed: true
        }, streamUsage);
        finalVersion.tokens = streamUsage.completion_tokens || finalVersion.tokens || 0;
        ensureAssistantVersionShape(tab.messages[msgIndex]);
    }

    if (!streamUsageApplied && streamUsage.total_tokens) {
        tab.tokenUsage = (tab.tokenUsage || 0) + streamUsage.total_tokens;
        const tokenDisplay = document.getElementById('tokenUsage');
        if (tokenDisplay) tokenDisplay.textContent = tab.tokenUsage;
    }

    if (streamUsage.prompt_tokens) {
        for (let i = tab.messages.length - 1; i >= 0; i--) {
            if (tab.messages[i].role === 'user') {
                tab.messages[i].tokens = streamUsage.prompt_tokens;
                break;
            }
        }
    }

    saveToStorage();
    renderSingleMessage(msgIndex);
    hideStatus();
}

function simulateTool(toolCall) {
    const { name, arguments: args } = toolCall.function;
    let params = {};
    try {
        params = JSON.parse(args);
    } catch (e) {
        return { error: "Failed to parse arguments" };
    }

    // 1. Get User Defined Tools
    const userCode = document.getElementById('toolCodeEditor').value;
    if (userCode) {
        try {
            // Create a function that executes the user's code
            // The user's code should RETURN an object of functions
            const createToolsIterator = new Function(userCode);
            const userTools = createToolsIterator();

            if (userTools && typeof userTools[name] === 'function') {
                try {
                    return userTools[name](params);
                } catch (err) {
                    return { error: `Execution Error in ${name}: ${err.message}` };
                }
            }
        } catch (e) {
            console.error("Error parsing user tool code", e);
            return { error: `Syntax Error in Tool Code: ${e.message}` };
        }
    }

    // 2. Default Simulator Fallback
    if (name === 'get_weather') {
        return {
            location: params.location,
            temperature: 22,
            unit: params.unit || 'celsius',
            condition: 'Sunny'
        };
    } else if (name === 'search_web') {
        return {
            query: params.query,
            results: [
                { title: "Result for " + params.query, snippet: "This is a simulated search result." }
            ]
        };
    }

    return { error: `Tool ${name} not implemented in simulator. Add implementation in the right panel.` };
}

// --- UTILS & UI HELPERS ---

function renderMessages() {
    const messages = chatTabs[activeTabIndex]?.messages || [];
    messages.forEach(msg => {
        if (isAssistantMessage(msg)) ensureAssistantVersionShape(msg);
    });

    if (messages.length === 0) {
        els.messages.innerHTML = `
            <div class="chat-placeholder">
                <img src="assets/happy_sitting_cat-removebg-preview.png" alt="Happy Cat" class="placeholder-cat">
                <h2>Meow! Welcome to DevTalk</h2>
                <p>Start a conversation by typing your prompt below, or select a saved model configuration on the left to get started!</p>
            </div>
        `;
    } else {
        els.messages.innerHTML = messages.map((msg, i) => renderMessageHTML(msg, i)).join('');
    }

    // Post-process for HighlightJS and Copy Buttons
    processMessageContent();

    // Auto scroll if near bottom
    if (isNearBottom()) {
        els.messages.scrollTop = els.messages.scrollHeight;
    }

    // Update token history estimate
    updateTokenHistoryEstimate();
}

// Helper to check if user is near the bottom of the chat
function isNearBottom() {
    const threshold = 100;
    return els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < threshold;
}

function renderMessageHTML(msg, i) {
    let contentDisplay = '';
    let isTool = msg.role === 'tool';
    let isUser = msg.role === 'user';
    const isAssistant = msg.role === 'assistant';

    if (isAssistant) {
        ensureAssistantVersionShape(msg);
    }

    // Handle Tool Calls Display
    if (msg.tool_calls) {
        contentDisplay += `<div class="tool-output">🛠 Calls: ${msg.tool_calls.map(t => t.function.name).join(', ')}</div>`;
    }

    // Handle content (can be string or array with images)
    if (msg.content) {
        const useMarkdown = document.getElementById('enableMarkdown').checked;

        // Check if content is an array (has images)
        if (Array.isArray(msg.content)) {
            // Render images first
            contentDisplay += renderImageContent(msg.content);
            // Then render text
            const textContent = getTextFromContent(msg.content);
            if (textContent) {
                if (useMarkdown && typeof marked !== 'undefined') {
                    contentDisplay += marked.parse(textContent);
                } else {
                    contentDisplay += escapeHtml(textContent);
                }
            }
        } else {
            // String content
            if (useMarkdown && typeof marked !== 'undefined') {
                contentDisplay += marked.parse(msg.content);
            } else {
                contentDisplay += escapeHtml(msg.content);
            }
        }
    }

    if (isTool) {
        const toolContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        contentDisplay = `<div class="tool-output">${escapeHtml(toolContent)}</div>`;
    }

    // Icons
    const editIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
    const deleteIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    const regenIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l5.64 5.64A9 9 0 0 0 20.49 15"></path></svg>`;
    const resendIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    const detailsIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>`;

    const roleDisplay = msg.role.toUpperCase();
    const versionCount = isAssistant ? getAssistantVersionCount(msg) : 0;
    const activeVersionIndex = isAssistant ? msg.activeVersionIndex || 0 : 0;
    const versionControls = isAssistant && versionCount > 1
        ? `
            <div class="message-versions">
                <button class="version-nav-btn" title="Previous version" onclick="event.stopPropagation(); switchAssistantVersion(${i}, -1)">&lt;</button>
                <span class="version-indicator">${activeVersionIndex + 1} / ${versionCount}</span>
                <button class="version-nav-btn" title="Next version" onclick="event.stopPropagation(); switchAssistantVersion(${i}, 1)">&gt;</button>
            </div>
        `
        : '';

    return `
        <div class="message" id="msg-container-${i}">
            <div class="message-header">
                <div class="message-meta">
                    <span class="message-role">${roleDisplay}</span>
                    ${versionControls}
                </div>
                <div class="message-actions">
                     <button class="action-btn" title="Copy" onclick="copyMessage(${i})">${copyIcon}</button>
                     ${isAssistant ? `<button class="action-btn" title="Details" onclick="toggleMessageDetails(${i})">${detailsIcon}</button>` : ''}
                     ${isAssistant ? `<button class="action-btn" title="Regenerate" onclick="regenerateMessage(${i})">${regenIcon}</button>` : ''}
                     ${isUser ? `<button class="action-btn" title="Resend from here" onclick="resendFromMessage(${i})">${resendIcon}</button>` : ''}
                     <button class="action-btn" title="Edit" onclick="startEditing(${i})">${editIcon}</button>
                     <button class="action-btn" title="Delete" onclick="deleteMessage(${i})">${deleteIcon}</button>
                </div>
            </div>
            <div class="message-content" id="msg-${i}">${contentDisplay}</div>
            ${renderMessageDetails(msg)}
        </div>
    `;
}

function processMessageContent(specificEl) {
    const parent = specificEl || document;
    parent.querySelectorAll('.message-content pre code').forEach((block) => {
        if (typeof hljs !== 'undefined') hljs.highlightElement(block);

        // Add Copy Button
        const pre = block.parentElement;
        if (!pre.querySelector('.copy-code-btn')) {
            const btn = document.createElement('button');
            btn.className = 'copy-code-btn';
            btn.textContent = 'Copy';
            btn.onclick = () => {
                navigator.clipboard.writeText(block.innerText);
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = 'Copy', 2000);
            };
            pre.appendChild(btn);
        }
    });
}

function renderSingleMessage(index) {
    const tab = chatTabs[activeTabIndex];
    if (!tab || !tab.messages[index]) return;
    if (isAssistantMessage(tab.messages[index])) ensureAssistantVersionShape(tab.messages[index]);

    const container = document.getElementById(`msg-container-${index}`);
    if (!container) return;

    const msg = tab.messages[index];
    const newHtml = renderMessageHTML(msg, index);

    // Create a temporary element to parse the HTML string
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newHtml;
    const newMessageEl = tempDiv.firstElementChild;

    // Replace the old message node with the new one
    container.replaceWith(newMessageEl);

    // Process highlight/copy buttons for this specific element
    processMessageContent(newMessageEl);
}

function updateTokenHistoryEstimate() {
    const tab = chatTabs[activeTabIndex];
    const tokenHistoryEl = document.getElementById('tokenHistory');
    if (!tokenHistoryEl || !tab) return;

    let totalTokens = 0;
    let hasStoredTokens = false;

    // Sum up stored token counts from messages
    if (tab.messages) {
        tab.messages.forEach(msg => {
            if (isAssistantMessage(msg)) ensureAssistantVersionShape(msg);
            if (msg.tokens !== undefined) {
                totalTokens += msg.tokens;
                hasStoredTokens = true;
            }
        });
    }

    // If we have stored tokens, show them; otherwise show estimate
    if (hasStoredTokens) {
        tokenHistoryEl.textContent = totalTokens.toLocaleString();
    } else {
        // Fallback: estimate based on characters (~4 chars per token)
        console.log("Token History: Using character-based estimation fallback.");
        let totalChars = 0;
        if (tab.systemPrompt) totalChars += tab.systemPrompt.length;
        if (tab.messages) {
            tab.messages.forEach(msg => {
                if (msg.content) totalChars += msg.content.length;
            });
        }
        const estimated = Math.ceil(totalChars / 4);
        tokenHistoryEl.textContent = `~${estimated.toLocaleString()}`;
    }
}


// --- CODE GENERATION ---

function updateGeneratedCode() {
    const outputEl = document.getElementById('codeOutput');
    if (!outputEl) return;

    const lang = document.getElementById('codeGenLang').value;
    const tab = chatTabs[activeTabIndex];
    if (!tab) return outputEl.value = "No active tab";

    const model = models[tab.modelIndex];
    if (!model) return outputEl.value = "Select a model to see code example";

    const fullUrl = normalizeUrl(model.baseUrl);
    const apiKey = model.apiKey.trim();

    // Detect if this is a Lightning.ai endpoint
    const isLightningAI = model.baseUrl.toLowerCase().includes('lightning.ai');

    // Prepare messages correctly (system + history)
    const apiMessages = [];
    if (tab.systemPrompt) apiMessages.push({ role: 'system', content: tab.systemPrompt });
    if (tab.messages) {
        apiMessages.push(...prepareCleanMessages(tab.messages));
    }

    // Prepare Tools
    let tools = null;
    if (els.enableTools.checked) {
        try {
            tools = JSON.parse(els.toolsEditor.value);
        } catch (e) { }
    }

    const payload = {
        model: model.name,
        messages: apiMessages,
        temperature: model.temperature
    };

    // Lightning.ai uses max_completion_tokens, others use max_tokens
    if (isLightningAI) {
        payload.max_completion_tokens = model.maxTokens;
    } else {
        payload.max_tokens = model.maxTokens;
    }

    if (tools) {
        payload.tools = tools;
        payload.tool_choice = "auto";
    }

    let code = '';
    if (lang === 'curl') {
        const headerAuth = apiKey ? `-H "Authorization: Bearer ${apiKey}"` : '';
        code = `curl ${fullUrl} \\
  -H "Content-Type: application/json" \\
  ${headerAuth} \\
  -d '${JSON.stringify(payload, null, 2)}'`;

    } else if (lang === 'python') {
        code = `import requests
import json

url = "${fullUrl}"
headers = {
    "Content-Type": "application/json"
    ${apiKey ? `, "Authorization": "Bearer ${apiKey}"` : ''}
}
payload = ${JSON.stringify(payload, null, 4)}

response = requests.post(url, headers=headers, json=payload)
print(response.json())`;

    } else if (lang === 'js') {
        code = `const url = "${fullUrl}";
const payload = ${JSON.stringify(payload, null, 2)};

fetch(url, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
        ${apiKey ? `, 'Authorization': 'Bearer ${apiKey}'` : ''}
    },
    body: JSON.stringify(payload)
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));`;
    }

    outputEl.value = code;
}

function startEditing(index) {
    const msgEl = document.getElementById(`msg-${index}`);
    const tab = chatTabs[activeTabIndex];
    if (!msgEl || !tab || !tab.messages[index]) return;

    const msg = tab.messages[index];
    const originalHeight = msgEl.offsetHeight;

    // Lock the container height to prevent layout shift
    const container = document.getElementById(`msg-container-${index}`);
    if (container) {
        container.style.minHeight = `${container.offsetHeight}px`;
    }

    // Replace content with a fixed-height scrollable textarea
    msgEl.innerHTML = `<textarea class="message-edit-area" id="edit-${index}">${msg.content}</textarea>`;
    const textarea = document.getElementById(`edit-${index}`);

    // Set fixed height with scroll
    textarea.style.height = `${Math.max(originalHeight, 100)}px`;
    textarea.style.maxHeight = `${Math.max(originalHeight, 100)}px`;
    textarea.style.overflowY = 'auto';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    // Event listeners
    textarea.addEventListener('blur', () => finishEditing(index, textarea.value));
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            renderSingleMessage(index); // Cancel
        }
        if (e.key === 'Enter' && e.ctrlKey) {
            textarea.blur();
        }
    });
}

function finishEditing(index, newContent) {
    const tab = chatTabs[activeTabIndex];
    const messages = tab.messages;

    if (messages[index] && messages[index].content !== newContent) {
        if (isAssistantMessage(messages[index])) {
            const activeVersion = getActiveAssistantVersion(messages[index]);
            if (activeVersion) {
                activeVersion.content = newContent;
                ensureAssistantVersionShape(messages[index]);
            }
        } else {
            messages[index].content = newContent;
        }
        saveToStorage();
        updateGeneratedCode();
    }

    // Surgical update: Only re-render this message
    renderSingleMessage(index);

    // Clear the min-height lock
    const container = document.getElementById(`msg-container-${index}`);
    if (container) container.style.minHeight = '';
}

function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight) + 'px';
}

function focusMessage(index) {
    startEditing(index);
}

function updateMessageContent(index, newContent) {
    // This is now handled by finishEditing, but keeping signature for safety if called elsewhere
    finishEditing(index, newContent);
}

function switchAssistantVersion(index, direction) {
    const tab = chatTabs[activeTabIndex];
    const msg = tab?.messages?.[index];
    if (!msg || !isAssistantMessage(msg)) return;

    ensureAssistantVersionShape(msg);
    const total = msg.versions.length;
    if (total <= 1) return;

    const nextIndex = msg.activeVersionIndex + direction;
    if (nextIndex < 0 || nextIndex >= total) return;

    msg.activeVersionIndex = nextIndex;
    ensureAssistantVersionShape(msg);
    saveToStorage();
    renderSingleMessage(index);
    updateGeneratedCode();
}

function toggleMessageDetails(index) {
    const tab = chatTabs[activeTabIndex];
    const msg = tab?.messages?.[index];
    if (!msg || !isAssistantMessage(msg)) return;

    msg.showDetails = !msg.showDetails;
    saveToStorage();
    renderSingleMessage(index);
}

function prepareForEdit(index) {
    // Handled by startEditing
}

function deleteMessage(index) {
    const messages = chatTabs[activeTabIndex].messages;
    messages.splice(index, 1);
    saveToStorage();
    renderMessages();
}

function clearChat() {
    chatTabs[activeTabIndex].messages = [];
    chatTabs[activeTabIndex].tokenUsage = 0;
    const tokenDisplay = document.getElementById('tokenUsage');
    if (tokenDisplay) tokenDisplay.textContent = 0;
    saveToStorage();
    renderMessages();
}

// --- MODAL LOGIC ---
let modalConfirmCallback = null;

function showConfirmModal(title, message, confirmText, callback) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
    const confirmBtn = document.getElementById('modalBtnConfirm');
    confirmBtn.textContent = confirmText;
    modalConfirmCallback = callback;
    document.getElementById('confirmModal').classList.add('open');
}

function closeModal() {
    document.getElementById('confirmModal').classList.remove('open');
    modalConfirmCallback = null;
}

// --- MESSAGE ACTIONS ---
function copyMessage(index) {
    const msg = chatTabs[activeTabIndex].messages[index];
    if (msg) {
        navigator.clipboard.writeText(msg.content);
        showStatus('Message copied!', '');
        setTimeout(hideStatus, 2000);
    }
}

function regenerateMessage(index) {
    const tab = chatTabs[activeTabIndex];
    if (!tab) return;

    // Check model BEFORE truncating to avoid data loss if model is not selected
    if (tab.modelIndex === null || !models[tab.modelIndex]) {
        showStatus('Select a model first', 'error');
        return;
    }

    // Truncate later history, but keep this assistant slot so we can add a new version to it.
    tab.messages = tab.messages.slice(0, index + 1);
    tab.messages[index] = ensureAssistantVersionShape(tab.messages[index]);
    saveToStorage();
    renderMessages();
    sendMessage(true, index);
}

function resendFromMessage(index) {
    const tab = chatTabs[activeTabIndex];
    if (!tab) return;

    // Check model BEFORE truncating
    if (tab.modelIndex === null || !models[tab.modelIndex]) {
        showStatus('Select a model first', 'error');
        return;
    }

    // Truncate messages to include this user message (index + 1)
    tab.messages = tab.messages.slice(0, index + 1);
    saveToStorage();
    renderMessages();
    sendMessage(true);
}

function toggleApiKey() {
    if (els.apiKey.type === 'password') {
        els.apiKey.type = 'text';
        document.getElementById('toggleApiKey').textContent = '🙈';
    } else {
        els.apiKey.type = 'password';
        document.getElementById('toggleApiKey').textContent = '👁️';
    }
}

function resetTools() {
    currentTools = JSON.parse(JSON.stringify(DEFAULT_TOOLS));
    els.toolsEditor.value = JSON.stringify(currentTools, null, 2);

    const codeEditor = document.getElementById('toolCodeEditor');
    if (codeEditor) codeEditor.value = DEFAULT_TOOL_CODE;

    saveToStorage();
    showStatus('Tools Resetted', '');
    setTimeout(hideStatus, 2000);
}

function formatTools() {
    try {
        const parsed = JSON.parse(els.toolsEditor.value);
        els.toolsEditor.value = JSON.stringify(parsed, null, 2);
    } catch (e) {
        showStatus('Invalid JSON', 'error');
    }
}

function exportChat() {
    const exportData = {
        version: "v3",
        date: new Date().toISOString(),
        models: models,
        activeModelIndex: activeModelIndex,
        chatTabs: chatTabs,
        activeTabIndex: activeTabIndex,
        tools: currentTools,
        toolCode: document.getElementById('toolCodeEditor').value,
        enableMarkdown: document.getElementById('enableMarkdown').checked
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "playground_full_export_" + Date.now() + ".json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function importChat(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            // Handle Full App Export (v3)
            if (data.chatTabs) {
                models = data.models || [];
                activeModelIndex = data.activeModelIndex;
                chatTabs = data.chatTabs || [];
                activeTabIndex = data.activeTabIndex || 0;
                if (data.tools) {
                    currentTools = data.tools;
                    els.toolsEditor.value = JSON.stringify(currentTools, null, 2);
                }
                if (data.toolCode) {
                    document.getElementById('toolCodeEditor').value = data.toolCode;
                }
            }
            // Handle Legacy Tab-only Export
            else if (data.messages) {
                chatTabs[activeTabIndex].messages = data.messages;
                if (data.systemPrompt) chatTabs[activeTabIndex].systemPrompt = data.systemPrompt;
            }

            saveToStorage();
            init(); // Re-initialize events and UI
            showStatus('Import Successful', '');
            setTimeout(hideStatus, 2000);

        } catch (err) {
            console.error(err);
            showStatus('Import failed', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function showStatus(text, type) {
    els.status.textContent = text;
    els.status.className = 'status ' + (type || '');
    els.status.style.display = 'block';
}

function hideStatus() {
    els.status.style.display = 'none';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- IMAGE UPLOAD FUNCTIONS ---

function handleImageSelect(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;

        const reader = new FileReader();
        reader.onload = (e) => {
            pendingImages.push({
                data: e.target.result,
                name: file.name,
                type: file.type
            });
            renderImagePreviews();
        };
        reader.readAsDataURL(file);
    }

    event.target.value = ''; // Reset input
}

function renderImagePreviews() {
    const previewArea = document.getElementById('imagePreviewArea');
    if (!previewArea) return;

    if (pendingImages.length === 0) {
        previewArea.style.display = 'none';
        previewArea.innerHTML = '';
        return;
    }

    previewArea.style.display = 'flex';
    previewArea.innerHTML = `
        <div class="image-warning">
            <span>⚠️ Vision models only</span>
        </div>
    ` + pendingImages.map((img, i) => `
        <div class="image-preview-item">
            <img src="${img.data}" alt="${escapeHtml(img.name)}">
            <button class="image-preview-remove" onclick="removePreviewImage(${i})">×</button>
        </div>
    `).join('');
}

function removePreviewImage(index) {
    pendingImages.splice(index, 1);
    renderImagePreviews();
}

function clearPendingImages() {
    pendingImages = [];
    renderImagePreviews();
}

// Format content for vision API (returns string or array with text+images)
function formatMessageContent(text, images) {
    if (!images || images.length === 0) {
        return text;
    }

    const content = [];

    // Add text part
    if (text) {
        content.push({ type: 'text', text: text });
    }

    // Add image parts
    for (const img of images) {
        content.push({
            type: 'image_url',
            image_url: { url: img.data }
        });
    }

    return content;
}

// Render image content in chat messages (supports both image_url and inline_data formats)
function renderImageContent(content) {
    if (typeof content === 'string') return '';
    if (!Array.isArray(content)) return '';

    let html = '';
    for (const part of content) {
        // OpenAI-compatible format (image_url)
        if (part.type === 'image_url' && part.image_url?.url) {
            html += `<img src="${part.image_url.url}" class="message-image" onclick="window.open(this.src, '_blank')">`;
        }
        // Gemini native format (inline_data)
        else if (part.inline_data && part.inline_data.data) {
            const mimeType = part.inline_data.mime_type || 'image/png';
            const dataUrl = `data:${mimeType};base64,${part.inline_data.data}`;
            html += `<img src="${dataUrl}" class="message-image" onclick="window.open(this.src, '_blank')">`;
        }
    }
    return html;
}

// Extract text from content (string or array, supports both OpenAI and Gemini formats)
function getTextFromContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    const textParts = [];
    for (const part of content) {
        // OpenAI format: { type: 'text', text: '...' }
        if (part.type === 'text' && part.text) {
            textParts.push(part.text);
        }
        // Gemini native format: { text: '...' } (without type wrapper)
        else if (part.text && !part.type) {
            textParts.push(part.text);
        }
    }
    return textParts.join('\n');
}

// Start
init();
