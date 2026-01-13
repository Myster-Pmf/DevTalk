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
    document.getElementById('btnSend').onclick = sendMessage;
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
            sendMessage();
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

    // Mobile Sidebar Toggles
    document.getElementById('btnToggleLeft').onclick = () => toggleSidebar('left');
    document.getElementById('btnToggleRight').onclick = () => toggleSidebar('right');
    document.getElementById('sidePaneOverlay').onclick = closeAllSidebars;

    document.getElementById('btnCopyGenCode').onclick = () => {
        const output = document.getElementById('codeOutput');
        output.select();
        document.execCommand('copy');
        showStatus('Copied to clipboard!', '');
        setTimeout(hideStatus, 2000);
    };

    // Initial code gen
    updateGeneratedCode();
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

    localStorage.setItem('chatPlayground_v3', JSON.stringify({
        models,
        activeModelIndex,
        chatTabs,
        activeTabIndex,
        tools: currentTools,
        toolCode: toolCode,
        enableMarkdown: enableMarkdown
    }));
}

// --- MODEL LOGIC ---

function getModelFromUI() {
    return {
        apiKey: els.apiKey.value.trim(),
        name: els.modelName.value.trim(),
        baseUrl: els.baseUrl.value.trim(),
        temperature: parseFloat(els.temperature.value),
        maxTokens: parseInt(els.maxTokens.value)
    };
}

function loadModelToUI(model) {
    if (!model) return;
    els.apiKey.value = model.apiKey || '';
    els.modelName.value = model.name || '';
    els.baseUrl.value = model.baseUrl || '';
    els.temperature.value = model.temperature || 0.7;
    els.maxTokens.value = model.maxTokens || 2048;
}

function saveModel() {
    const model = getModelFromUI();
    if (!model.name) return showStatus('Name required', 'error');
    models.push(model);
    activeModelIndex = models.length - 1;
    saveToStorage();
    renderModels();
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
}

function closeTab(index, e) {
    e.stopPropagation();
    if (chatTabs.length <= 1) return; // Keep at least one

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
    let cleaned = baseUrl.replace(/\/+$/, "");
    if (!cleaned.endsWith('/chat/completions')) {
        return `${cleaned}/chat/completions`;
    }
    return cleaned;
}

// Helper to strip extra fields (like 'tokens') before sending to AI providers
function prepareCleanMessages(messages) {
    return messages.map(m => {
        const cleanMsg = { role: m.role, content: m.content || "" };
        if (m.tool_calls) cleanMsg.tool_calls = m.tool_calls;
        if (m.tool_call_id) cleanMsg.tool_call_id = m.tool_call_id;
        return cleanMsg;
    });
}

async function sendMessage(isRegen = false) {
    const tab = chatTabs[activeTabIndex];
    if (!tab || tab.modelIndex === null) return showStatus('Select a model', 'error');

    // 1. Add User Message to UI (Skip if regenerating)
    // Check for explicit true to avoid MouseEvent misinterpretation
    if (isRegen !== true) {
        const content = els.userInput.value.trim();
        // Allow empty if intended.
        tab.messages.push({ role: 'user', content });
        els.userInput.value = '';
        renderMessages();
        updateGeneratedCode();
    }

    // Get current model settings
    const model = models[tab.modelIndex];

    // Check if user changed input key without saving
    if (els.apiKey.value.trim() !== model.apiKey) {
        if (!isRegen) { // Only prompt if this is a fresh send
            if (confirm("API Key in input differs from saved model. Update model?")) {
                updateModel();
            } else { return; }
        }
    }
    showStatus('Sending...', 'loading');

    // 2. Prepare Payload
    const history = prepareCleanMessages(tab.messages);
    const apiMessages = [];
    if (tab.systemPrompt) apiMessages.push({ role: 'system', content: tab.systemPrompt });
    apiMessages.push(...history);

    const requestBody = {
        model: model.name,
        messages: apiMessages,
        temperature: model.temperature,
        max_tokens: model.maxTokens,
    };

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

    const endpointUrl = normalizeUrl(model.baseUrl.trim());

    try {
        // --- PROXY REQUEST ---
        // --- PROXY REQUEST ---
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: endpointUrl,
                apiKey: model.apiKey.trim(),
                body: requestBody
            })
        });

        // Get the response text first to handle non-JSON errors
        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            // Server returned non-JSON (like "Internal Server Error" string)
            throw new Error(responseText || `HTTP ${response.status}`);
        }

        if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        const assistantMessage = data.choices[0].message;

        // 4. Handle Response & Tools
        const usage = data.usage;
        if (usage && usage.total_tokens) {
            tab.tokenUsage = (tab.tokenUsage || 0) + usage.total_tokens;
            const tokenDisplay = document.getElementById('tokenUsage');
            if (tokenDisplay) tokenDisplay.textContent = tab.tokenUsage;

            // Store prompt_tokens on the last user message
            if (usage.prompt_tokens) {
                for (let i = tab.messages.length - 1; i >= 0; i--) {
                    if (tab.messages[i].role === 'user') {
                        tab.messages[i].tokens = usage.prompt_tokens;
                        break;
                    }
                }
            }
        }

        if (assistantMessage.tool_calls) {
            tab.messages.push({
                role: 'assistant',
                content: assistantMessage.content || '',
                tool_calls: assistantMessage.tool_calls,
                tokens: usage?.completion_tokens || 0
            });
            renderMessages(); // Show tool call in UI

            // Simulate Tool Execution
            for (const toolCall of assistantMessage.tool_calls) {
                const toolResult = simulateTool(toolCall);
                tab.messages.push({
                    role: 'tool',
                    content: JSON.stringify(toolResult),
                    tool_call_id: toolCall.id
                });
            }
            // Optional: Recursively call sendMessage here if you want automatic follow-up
            // For playground, we usually just show the result and let user continue or re-send
            saveToStorage();
            renderMessages();
            hideStatus();

        } else {
            tab.messages.push({
                role: 'assistant',
                content: assistantMessage.content,
                tokens: usage?.completion_tokens || 0
            });
            saveToStorage();
            renderMessages();
            updateGeneratedCode();
            hideStatus();
        }

    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
        console.error(error);
    }
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
    els.messages.innerHTML = messages.map((msg, i) => renderMessageHTML(msg, i)).join('');

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

    // Handle Tool Calls Display
    if (msg.tool_calls) {
        contentDisplay += `<div class="tool-output">🛠 Calls: ${msg.tool_calls.map(t => t.function.name).join(', ')}</div>`;
    }

    if (msg.content) {
        const useMarkdown = document.getElementById('enableMarkdown').checked;
        if (useMarkdown && typeof marked !== 'undefined') {
            // Lex the content into top-level blocks
            const tokens = marked.lexer(msg.content);
            contentDisplay += tokens.map((token, blockIdx) => {
                // Render this individual token
                const rendered = marked.parse(token.raw);
                return `<div class="msg-block" data-block-idx="${blockIdx}" onclick="startBlockEdit(${i}, ${blockIdx}, event)">${rendered}</div>`;
            }).join('');
        } else {
            contentDisplay += `<div class="msg-block" data-block-idx="0" onclick="startBlockEdit(${i}, 0, event)">${escapeHtml(msg.content)}</div>`;
        }
    }

    if (isTool) {
        contentDisplay = `<div class="tool-output">${escapeHtml(msg.content)}</div>`;
    }

    // Icons
    const editIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
    const deleteIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    const regenIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l5.64 5.64A9 9 0 0 0 20.49 15"></path></svg>`;
    const resendIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;

    const roleDisplay = msg.role.toUpperCase();
    const isAssistant = msg.role === 'assistant';

    return `
        <div class="message" id="msg-container-${i}">
            <div class="message-header">
                <span class="message-role">${roleDisplay}</span>
                <div class="message-actions">
                     <button class="action-btn" title="Copy" onclick="copyMessage(${i})">${copyIcon}</button>
                     ${isAssistant ? `<button class="action-btn" title="Regenerate" onclick="regenerateMessage(${i})">${regenIcon}</button>` : ''}
                     ${isUser ? `<button class="action-btn" title="Resend from here" onclick="resendFromMessage(${i})">${resendIcon}</button>` : ''}
                     <button class="action-btn" title="Edit" onclick="startEditing(${i})">${editIcon}</button>
                     <button class="action-btn" title="Delete" onclick="deleteMessage(${i})">${deleteIcon}</button>
                </div>
            </div>
            <div class="message-content" id="msg-${i}">${contentDisplay}</div>
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
        temperature: model.temperature,
        max_tokens: model.maxTokens
    };
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

function startBlockEdit(msgIdx, blockIdx, event) {
    if (event) event.stopPropagation();

    const msgContainer = document.getElementById(`msg-${msgIdx}`);
    const blockEl = msgContainer.querySelector(`[data-block-idx="${blockIdx}"]`);
    const tab = chatTabs[activeTabIndex];
    if (!blockEl || !tab || !tab.messages[msgIdx]) return;

    const msg = tab.messages[msgIdx];
    const tokens = marked.lexer(msg.content);
    const token = tokens[blockIdx];
    if (!token) return;
    const originalHeight = blockEl.offsetHeight;
    blockEl.classList.add('editing');

    // Replace content of ONLY THIS BLOCK with a textarea and a preview div
    blockEl.innerHTML = `
        <div class="block-editor-container">
            <textarea class="message-edit-area" id="edit-${msgIdx}-${blockIdx}">${token.raw}</textarea>
            <div class="block-live-preview" id="preview-${msgIdx}-${blockIdx}"></div>
        </div>
    `;
    const textarea = document.getElementById(`edit-${msgIdx}-${blockIdx}`);
    const preview = document.getElementById(`preview-${msgIdx}-${blockIdx}`);

    // Initial resize and render
    textarea.style.height = `${originalHeight}px`;
    autoResizeTextarea(textarea);
    if (preview) preview.innerHTML = marked.parse(token.raw);
    textarea.focus();

    // Event listeners
    textarea.addEventListener('input', () => {
        autoResizeTextarea(textarea);
        if (preview) preview.innerHTML = marked.parse(textarea.value);
    });
    textarea.addEventListener('blur', () => finishBlockEdit(msgIdx, blockIdx, textarea.value));
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            renderSingleMessage(msgIdx); // Cancel
        }
        if (e.key === 'Enter' && e.ctrlKey) {
            textarea.blur();
        }
    });
}

function finishBlockEdit(msgIdx, blockIdx, newRaw) {
    const tab = chatTabs[activeTabIndex];
    const msg = tab.messages[msgIdx];
    if (!msg) return;

    const tokens = marked.lexer(msg.content);
    if (tokens[blockIdx]) {
        if (tokens[blockIdx].raw !== newRaw) {
            tokens[blockIdx].raw = newRaw;
            // Reconstruct the full message content
            msg.content = tokens.map(t => t.raw).join('');
            saveToStorage();
            updateGeneratedCode();
        }
    }

    // Surgical update: Only re-render this message
    renderSingleMessage(msgIdx);
}

function startEditing(index) {
    // Default to editing the first block or finding where the user clicked
    startBlockEdit(index, 0);
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

    // Truncate messages up to this point (excluding this assistant message)
    tab.messages = tab.messages.slice(0, index);
    saveToStorage();
    renderMessages();
    sendMessage(true);
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

// Start
init();