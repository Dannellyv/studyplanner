# AI Study Planner

A multi-agent AI system that helps college students study smarter through personalized scheduling, study method recommendations, session logging, performance analysis, and burnout optimization.

## Tech Stack

- **Frontend**: React 18 + Vite
- **AI Backend**: Anthropic Claude API (`claude-sonnet-4-20250514`)
- **Deployment**: Vercel
- **Styling**: Inline CSS with glassmorphism dark theme

## Pipeline Architecture

```
Student Message
    ↓
Classifier Agent (routes to specialists)
    ↓
Specialist Agents in parallel (Planner, Strategy, Feedback Logger, Analyzer, Optimizer)
    ↓
Critic Agent (reviews draft quality)
    ↓
Orchestrator Agent (formats final reply)
    ↓
Student receives response
```

## Setup Instructions

### Prerequisites

- Node.js v18 or higher
- An Anthropic API key (get one at https://console.anthropic.com)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   cd YOUR_REPO_NAME
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create your environment file**

   Create a file called `.env` in the project root:
   ```
   VITE_ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open the app**

   Visit `http://localhost:5173` in your browser.

## Running the Evaluation Script

### Prerequisites

The evaluation script requires Node.js and a valid Anthropic API key.

### Steps

1. **Navigate to the project root**
   ```bash
   cd YOUR_REPO_NAME
   ```

2. **Run the evaluation**
   ```bash
   ANTHROPIC_API_KEY=sk-ant-your-key-here node evaluation_script.js
   ```

3. **View results**

   Results are printed to the console and saved to `evaluation_results.json`.

### What the script does

- Runs 15 scripted benchmark prompts through the full multi-agent pipeline
- Uses a secondary Claude call as an LLM judge to score each response
- Outputs task success rate, output quality, API call count, and HHH scores
- Saves structured results to `evaluation_results.json`

## Project Structure

```
study-planner/
├── src/
│   └── App.jsx              # Full multi-agent pipeline + UI
├── evaluation_script.js     # Milestone III evaluation script
├── evaluation_results.json  # Output from evaluation run
├── test_cases.json          # Structured benchmark test cases
├── index.html
├── package.json
├── vite.config.js
├── .env                     # Not committed — add your API key here
└── README.md
```

## Agent Descriptions

| Agent | Role |
|---|---|
| Classifier | Routes student message to correct specialist agents |
| Planner | Generates personalized study schedules |
| Strategy | Recommends evidence-based study methods |
| Feedback Logger | Logs and acknowledges study sessions |
| Analyzer | Identifies patterns in study history |
| Optimizer | Reviews approach and suggests improvements |
| Critic | Reviews draft quality before delivery |
| Orchestrator | Formats all outputs into one cohesive reply |

## Deployment

The app is deployed on Vercel. To deploy your own instance:

1. Push your code to GitHub
2. Go to vercel.com and import your repository
3. Add `VITE_ANTHROPIC_API_KEY` as an environment variable in Vercel settings
4. Redeploy

## Notes

- Conversation history is stored in React state only — it clears on page reload
- No user data is stored server-side
- API key is secured in environment variables and never exposed in frontend code
