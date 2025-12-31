# DevTalk - Pro AI Model Playground

DevTalk is a high-performance, developer-centric web playground for testing and interacting with various AI models. Inspired by the **Groq Playground**, it focuses on extreme simplicity and speed, providing a distraction-free environment for model experimentation.

**🚀 Try it now:** [dev-talk-beta.vercel.app](https://dev-talk-beta.vercel.app/)

> [!NOTE]
> **Privacy First**: Everything is stored locally in your browser's LocalStorage. Your API keys and chat history never leave your machine (except when sent directly to the model endpoint).

![DevTalk Banner](https://img.shields.io/badge/DevTalk-AI_Playground-blueviolet?style=for-the-badge&logo=openai)

## 🚀 Key Features

### 🛠 Model & Tool Management
- **Multi-Model Support**: Easily switch between different model providers (OpenAI compatible APIs). Configure API keys, base URLs, and parameters like temperature and max tokens.
- **Dynamic Tool Simulation**: Implement and test LLM tools (function calling) on the fly using the built-in JavaScript editor.
- **System Prompts**: Set per-tab system prompts to steer model behavior.

### 💬 Advanced Chat Interface
- **Tabbed Experience**: Organize multiple chat sessions in tabs. Support for right-click tab renaming and full persistence.
- **Markdown Rendering**: Toggleable GitHub-style markdown rendering with syntax highlighting via `marked.js` and `highlight.js`.
- **Direct Message Editing**: Click any message to edit its content directly.
- **Token Tracking**: Real-time token usage monitoring for the current session.

### 💻 Developer Tools
- **Reactive Code Generator**: Automatically generates production-ready code snippets in **cURL**, **Python (requests)**, and **Node.js (fetch)** based on your current playground settings.
- **Full State Portability**: Export and import your entire environment, including all models, tabs, tool definitions, and custom tool code.

### 📱 Responsive Design
- **Mobile First**: Fully responsive layout with slide-out sidebars (80% width) and overlay system for a seamless mobile experience.

---

## 🛠 Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3.
- **Markdown**: [Marked.js](https://marked.js.org/) & [Highlight.js](https://highlightjs.org/).
- **Backend (Proxy)**: Node.js / Vercel Serverless Functions (for handling CORS and API key security).
- **Icons**: [Lucide](https://lucide.dev/) (SVG implementation).

---

## 🚦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- [npm](https://www.npmjs.com/)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Myster-Pmf/DevTalk.git
   cd DevTalk
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the development server**:
   ```bash
   npm run dev
   ```
   *The app should now be running at `http://localhost:3000` (or your configured port).*

---

## 📖 Usage

1. **Configure a Model**: Enter your API key, Model Name, and Base URL in the left sidebar.
2. **Setup Tools (Optional)**: In the right sidebar, define tool JSON and write your simulator logic in the JS code editor.
3. **Chat**: Use the bottom input to send messages. Toggle Markdown in the right panel if needed.
4. **Export Your Work**: Use the "Export Chat" button to save your entire configuration for later use.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

Developed with ❤️ by [Myster-Pmf](https://github.com/Myster-Pmf)
