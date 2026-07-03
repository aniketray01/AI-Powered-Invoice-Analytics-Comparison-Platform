# 🤖 AI-Powered Invoice Analytics & Comparison Platform

An advanced, interactive React dashboard and intelligent retrieval-augmented co-pilot designed to streamline telecom invoice auditing, detect financial leakage, validate charge formulas, and analyze site-level operational spending. 

Built on top of **React**, **Vite**, and **Firebase**, it utilizes **OpenAI GPT-4o** and **Infozech’s Telecom Knowledge Base** to act as a domain-expert auditor.

---

## 🌟 Key Features

### 1. 📊 Single-Invoice Auditing
* **Site & Regional Analytics**: Automatically aggregates transaction records by site IDs, locations, regions, and cost centers.
* **Cost Breakdowns**: Visualizes spending patterns across diesel generator (DG) usage, electricity board (EB) grid power, and miscellaneous service costs using interactive **Recharts**.
* **Forensic Anomaly Detection**: Highlights high-volatility sites, suspicious adjustments, back-billing anomalies, and fuel/grid consumption disparities.

### 2. ⚖️ Dual-Invoice Comparison
* **Variance Reports**: Side-by-side comparison of billing data across two periods.
* **Deep Delta Analysis**: Instantly highlights cost fluctuations, newly added tower sites, decommissioning changes, and regional spend increases.
* **Site-Level Details**: Export comparison matrices to PDF or Excel.

### 3. ⚙️ Dynamic Charge Validation Engine
* **Expression Parser**: Create custom audit rules and mathematical validation formulas to test line-item pricing (e.g., tariff rates, currency multipliers, decimal limits).
* **Bulk Audit**: Upload transaction files to execute formulas against hundreds of records concurrently.
* **Regional Rules**: Save verification rules categorized by country code and activation date.

### 4. 💬 Context-Aware RAG Co-Pilot
* **Context-Driven Auditing**: The floating AI assistant reads your active dashboard view (single audit data or comparative delta metrics) to answer highly specific questions.
* **Infozech Knowledge RAG**: Ingests domain-specific billing procedures, tax guidelines, and contract auditing practices from the integrated Infozech knowledge document.
* **Voice-Enabled Assistant**: Features built-in speech-to-text input and natural text-to-speech output.

---

## 🛠️ Technology Stack

* **Frontend Framework**: [React (v18)](https://react.dev/) + [Vite](https://vitejs.dev/) (lightning-fast development build tool)
* **Authentication & Database**: [Firebase Auth](https://firebase.google.com/docs/auth) & [Firestore](https://firebase.google.com/docs/firestore)
* **Styling & Animations**: Vanilla CSS + [Framer Motion](https://www.framer.com/motion/) (for smooth page and modal transitions)
* **Data Visualization**: [Recharts](https://recharts.org/) (for interactive graphs & trend tracking)
* **Parsers**: [PapaParse](https://www.papaparse.com/) (CSV) + [SheetJS / XLSX](https://sheetjs.com/) (Excel)
* **Document Exports**: [jsPDF](https://github.com/parallax/jsPDF) & [html2canvas](https://html2canvas.hertzen.com/)
* **AI Orchestration**: Custom developer proxy middleware in `vite.config.js` securely routing text embeddings and chat completions via OpenAI API.
*  **AI** : Gemini 3.5 Flash

---

## 📂 Project Structure

```bash
AI_Chatbot/
├── Files/                     # Local test datasets (CSV invoices, transactions)
├── dist/                      # Compiled production build output (git-ignored)
├── public/                    # Static assets (icons, images)
├── src/
│   ├── components/            # UI components (Login, Profile, ForensicChat dashboard overlay)
│   ├── context/               # React Context Providers (AuthContext for user sessions)
│   ├── data/                  # Static invoice mock configurations
│   ├── services/
│   │   ├── filterService.js        # Rule-based query tokenization and keyword matching
│   │   ├── ragService.js           # Single/Dual invoice RAG indexer and embeddings matcher
│   │   ├── knowledgeRagService.js  # Infozech RAG knowledge document embeddings pipeline
│   │   ├── summaryService.js       # Basic invoice aggregations
│   │   └── infozech_rag_knowledge.txt # Core domain knowledge database
│   ├── utils/                 # Exporters (PDF, Excel) and Voice synthesis assistants
│   ├── firebase.config.js     # Firebase client configuration
│   ├── App.jsx                # Main application hub (state manager, landing page, charge validator)
│   └── main.jsx               # Entrypoint
├── vite.config.js             # Vite configuration & OpenAI secure dev proxy middleware
├── .env.local                 # Local environment variables (git-ignored)
└── .gitignore                 # Safe file-tracking whitelist
```

---

## 🚀 Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### 1. Clone & Install Dependencies
Navigate to the directory and install all packages:
```bash
npm install
```

### 2. Configure Environment Variables
Create a file named `.env.local` in the root directory (this file is excluded from git for security):
```env
VITE_OPENAI_KEY=your_openai_api_key_here
VITE_GEMINI_API_KEY=your_google_gemini_api_key_here
```
> ⚠️ **Note**: Do not commit this file. Keep your keys private.

### 3. Run the Development Server
```bash
npm run dev
```
Open your browser and navigate to the local address provided (typically `http://localhost:5173`).

---

## 🔒 Security & Developer Proxy

To prevent exposing raw API keys on the frontend, the app utilizes an **OpenAI Developer Proxy** built into [vite.config.js](file:///f:/Aniket%20PW/Projects/AI_Chatbot_new/AI_Chatbot/vite.config.js). 

When running in development, client requests sent to `/api/openai` are caught by the Vite server middleware. The middleware attaches the server-side `VITE_OPENAI_KEY` header before forwarding requests to OpenAI's endpoints (`api.openai.com/v1/*`), keeping your API keys hidden from the client browser console.

---

## 📄 License
This project is configured as private. All rights reserved.
