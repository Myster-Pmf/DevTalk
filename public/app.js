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
    systemPrompt: document.getElementById('systemPrompt'),
    userInput: document.getElementById('userInput'),
    modelList: document.getElementById('modelList'),
    tabs: document.getElementById('tabs'),
    messages: document.getElementById('messages'),
    status: document.getElementById('status'),
    toolsEditor: document.getElementById('toolsEditor'),
    enableTools: document.getElementById('enableTools')
};

// --- INITIALIZATION ---
function init() {
    loadFromStorage();
    
    // Set initial tool JSON in the editor
    if (!els.toolsEditor.value) {
        els.toolsEditor.value = JSON.stringify(currentTools, null, 2);
    }

    // Event Listeners
    document.getElementById('btnAddModel').onclick = saveModel;
    document.getElementById('btnUpdateModel').onclick = updateModel;
    document.getElementById('btnSend').onclick = sendMessage;
    document.getElementById('btnClear').onclick = clearChat;
    document.getElementById('btnExport').onclick = exportChat;
    document.getElementById('toggleApiKey').onclick = toggleApiKey;
    document.getElementById('btnResetTools').onclick = resetTools;
    document.getElementById('btnFormatTools').onclick = formatTools;
    document.getElementById('importFile').onchange = importChat;

    // Save System Prompt to TAB (not model) on input
    els.systemPrompt.addEventListener('input', () => {
        if (chatTabs[activeTabIndex]) {
            chatTabs[activeTabIndex].systemPrompt = els.systemPrompt.value;
            saveToStorage();
        }
    });

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
        switchTab(activeTabIndex); // Ensure correct tab data loads
    }
    
    renderModels();
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
            if(data.tools) {
                currentTools = data.tools;
                els.toolsEditor.value = JSON.stringify(currentTools, null, 2);
            }
        } catch (e) { console.error("Storage Error", e); }
    }
}

function saveToStorage() {
    // Update tools from editor before saving state
    try {
        currentTools = JSON.parse(els.toolsEditor.value);
    } catch(e) {}

    localStorage.setItem('chatPlayground_v3', JSON.stringify({
        models,
        activeModelIndex,
        chatTabs,
        activeTabIndex,
        tools: currentTools
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
    showStatus('Model Updated', '');
    setTimeout(hideStatus, 2000);
}

function deleteModel(index, e) {
    if(e) e.stopPropagation();
    models.splice(index, 1);
    if (activeModelIndex === index) activeModelIndex = null;
    else if (activeModelIndex > index) activeModelIndex--;
    
    // Remove model ref from tabs
    chatTabs.forEach(t => { if(t.modelIndex === index) t.modelIndex = null; });
    
    saveToStorage();
    renderModels();
    if(activeModelIndex !== null) loadModelToUI(models[activeModelIndex]);
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
}

function renderModels() {
    els.modelList.innerHTML = models.map((m, i) => `
        <div class="model-item ${i === activeModelIndex ? 'active' : ''}" onclick="selectModel(${i})">
            <div class="model-name">${m.name}</div>
            <div class="model-url">${m.baseUrl}</div>
            <button class="danger" style="margin-top:5px; padding:4px 8px; font-size:10px;" onclick="deleteModel(${i}, event)">Delete</button>
        </div>
    `).join('');
}

// --- TAB LOGIC ---

function createNewTab() {
    chatTabs.push({
        id: Date.now(),
        messages: [],
        modelIndex: activeModelIndex,
        systemPrompt: "You are a helpful assistant." // Default per tab
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
    els.systemPrompt.value = tab.systemPrompt || '';
    
    // 2. If tab has a model associated, load it into UI
    if (tab.modelIndex !== null && models[tab.modelIndex]) {
        activeModelIndex = tab.modelIndex;
        loadModelToUI(models[tab.modelIndex]);
        renderModels(); // Update active highlight
    }
    
    renderTabs();
    renderMessages();
}

function closeTab(index, e) {
    e.stopPropagation();
    if (chatTabs.length <= 1) return; // Keep at least one
    
    chatTabs.splice(index, 1);
    if (activeTabIndex >= chatTabs.length) activeTabIndex = chatTabs.length - 1;
    
    saveToStorage();
    switchTab(activeTabIndex);
}

function renderTabs() {
    els.tabs.innerHTML = chatTabs.map((tab, i) => {
        // Safe check for model existence
        const mName = (tab.modelIndex !== null && models[tab.modelIndex]) 
            ? models[tab.modelIndex].name 
            : 'No Model';
            
        return `
            <div class="tab ${i === activeTabIndex ? 'active' : ''}" onclick="switchTab(${i})">
                <span>Tab ${i+1}: ${mName.substring(0, 15)}...</span>
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

async function sendMessage() {
    const tab = chatTabs[activeTabIndex];
    if (!tab || tab.modelIndex === null) return showStatus('Select a model', 'error');
    
    const content = els.userInput.value.trim();
    if (!content) return;

    // Get current model settings
    const model = models[tab.modelIndex];
    
    // Check if user changed input key without saving
    if(els.apiKey.value.trim() !== model.apiKey) {
        if(confirm("API Key in input differs from saved model. Update model?")) {
            updateModel();
        } else { return; }
    }

    // 1. Add User Message to UI
    tab.messages.push({ role: 'user', content });
    els.userInput.value = '';
    renderMessages();
    showStatus('Sending...', 'loading');

    // 2. Prepare Payload
    const apiMessages = [];
    if (tab.systemPrompt) apiMessages.push({ role: 'system', content: tab.systemPrompt });
    apiMessages.push(...tab.messages);

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
        } catch(e) {
            showStatus('Error in Tools JSON', 'error');
            return;
        }
    }

    const endpointUrl = normalizeUrl(model.baseUrl.trim());

    try {
        // --- PROXY REQUEST ---
        // We send the request to OUR /api/proxy endpoint
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: endpointUrl,
                apiKey: model.apiKey.trim(),
                body: requestBody
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        const assistantMessage = data.choices[0].message;

        // 4. Handle Response & Tools
        if (assistantMessage.tool_calls) {
            tab.messages.push({
                role: 'assistant',
                content: assistantMessage.content || '',
                tool_calls: assistantMessage.tool_calls
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
                content: assistantMessage.content
            });
            saveToStorage();
            renderMessages();
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
    } catch(e) {
        return { error: "Failed to parse arguments" };
    }

    // Add logic here for your tools
    if (name === 'get_weather') {
        return {
            location: params.location,
            temperature: 22,
            unit: params.unit || 'celsius',
            condition: 'Sunny'
        };
    } else if (name === 'search_web') {
        // Returning dummy search results
        return {
            query: params.query,
            results: [
                { title: "Result for " + params.query, snippet: "This is a simulated search result." }
            ]
        };
    }
    
    return { error: `Tool ${name} not implemented in simulator` };
}

// --- UTILS & UI HELPERS ---

function renderMessages() {
    const messages = chatTabs[activeTabIndex]?.messages || [];
    els.messages.innerHTML = messages.map((msg, i) => {
        let contentDisplay = '';
        let isTool = msg.role === 'tool';
        let isAssistant = msg.role === 'assistant';
        let isUser = msg.role === 'user';
        
        // Handle Tool Calls Display
        if (msg.tool_calls) {
             contentDisplay += `<div class="tool-output">🛠 Calls: ${msg.tool_calls.map(t => t.function.name).join(', ')}</div>`;
        }
        
        // Handle Content
        if (msg.content) {
            // For editable content, we don't escape HTML in the attribute but we do for display if NOT editing.
            // However, contenteditable works with innerText/innerHTML. 
            // We'll trust escapeHtml for the initial render.
            contentDisplay += escapeHtml(msg.content);
        }

        if (isTool) {
             contentDisplay = `<div class="tool-output">${escapeHtml(msg.content)}</div>`;
        }

        // Icons
        const editIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
        const deleteIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        const minusIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>`;

        // User requested "delete icon instead of minus", but the image showed a minus-circle.
        // I will use a trash icon as it is more standard for "delete", or the minus circle if they strictly want "image like" but "delete icon" implies trash.
        // The prompt says "use delete icon instead of minus", implying the OLD one was minus (or text) and they want a delete icon.
        // I'll use a Trash Icon.

        const roleDisplay = msg.role.toUpperCase();
        
        // Editable: only User and Assistant text content (not tool outputs usually)
        const isEditable = !isTool;

        return `
            <div class="message">
                <div class="message-header">
                    <span class="message-role">${roleDisplay}</span>
                    <div class="message-actions">
                         ${isEditable ? `<button class="action-btn" title="Edit" onclick="focusMessage(${i})">${editIcon}</button>` : ''}
                         <button class="action-btn" title="Delete" onclick="deleteMessage(${i})">${deleteIcon}</button>
                    </div>
                </div>
                <div class="message-content" 
                     id="msg-${i}"
                     ${isEditable ? 'contenteditable="true"' : ''} 
                     onblur="updateMessageContent(${i}, this.innerText)">${contentDisplay}</div>
            </div>
        `;
    }).join('');
    
    // Auto scroll
    els.messages.scrollTop = els.messages.scrollHeight;
}

function focusMessage(index) {
    const el = document.getElementById(`msg-${index}`);
    if (el) {
        el.focus();
        // Move cursor to end (optional, simple focus is often enough)
    }
}

function updateMessageContent(index, newContent) {
    const messages = chatTabs[activeTabIndex].messages;
    if (messages[index]) {
        if (messages[index].content !== newContent) {
            messages[index].content = newContent;
            saveToStorage();
            // Optional: visual feedback
        }
    }
}

function deleteMessage(index) {
    const messages = chatTabs[activeTabIndex].messages;
    messages.splice(index, 1);
    saveToStorage();
    renderMessages();
}

function clearChat() {
    if(confirm("Clear this chat history?")) {
        chatTabs[activeTabIndex].messages = [];
        saveToStorage();
        renderMessages();
    }
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
}

function formatTools() {
    try {
        const parsed = JSON.parse(els.toolsEditor.value);
        els.toolsEditor.value = JSON.stringify(parsed, null, 2);
    } catch(e) {
        showStatus('Invalid JSON', 'error');
    }
}

function exportChat() {
    const tab = chatTabs[activeTabIndex];
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tab, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "chat_export_" + Date.now() + ".json");
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
            if (data.messages) {
                chatTabs[activeTabIndex].messages = data.messages;
                if(data.systemPrompt) chatTabs[activeTabIndex].systemPrompt = data.systemPrompt;
                saveToStorage();
                renderMessages();
                switchTab(activeTabIndex); // Update prompts
            }
        } catch(err) { showStatus('Import failed', 'error'); }
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