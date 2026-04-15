import { useState, useRef, useEffect } from "react";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 900;

const AGENTS = {
  planner:  { label: "Planner",        color: "#60a5fa" },
  strategy: { label: "Strategy",        color: "#c084fc" },
  feedback: { label: "Logger",          color: "#fb923c" },
  analyzer: { label: "Analyzer",        color: "#34d399" },
  critic:   { label: "Optimizer",       color: "#f87171" },
};

const AGENT_PROMPTS = {
  planner: `You are the Planner Agent in a multi-agent AI study planning system.
If you don't know their available hours, courses, or exam dates, ask before making a schedule.
Keep responses short and conversational, like texting a helpful friend.
Use simple bullet points only when listing a schedule. Otherwise just talk naturally.
Start your response with "Planner Agent:". Max 80 words, be specific and structured.`,

  strategy: `You are the Study Strategy Agent in a multi-agent AI study planning system.
Your role: Recommend and explain evidence-based study methods tailored to the subject.
Methods to draw from: active recall, spaced repetition, Pomodoro technique, flashcards, practice problems, concept mapping, interleaving.
Ask about how they like to learn, what has worked before, or what subject they're studying if you don't know.
If they have no preference, ask 1-2 quick questions to figure out what would suit them (e.g. do they prefer visual learning, reading, practice problems?).
Never label yourself or say which agent you are.
Start your response with "Strategy Agent:". Explain WHY the method fits this subject. Keep it short, warm, and conversational. Max 80 words`, 

  feedback: `You are the Feedback & Logging Agent in a multi-agent AI study planning system.
Your role: Extract and log study session data from the student's message.
Log: subject studied, duration, method used, self-reported effectiveness (1-5), mood, notes.
If details are missing (how long, what subject, what method, how it went), ask for them casually.
Never label yourself or say which agent you are.
Start your response with "Feedback Logger:". Acknowledge the session warmly and present the logged data in a clear format. Keep it short and encouraging. Max 60 words.`,

  analyzer: `You are the Performance Analyzer Agent in a multi-agent AI study planning system.
Your role: Analyze patterns in the student's study history from the conversation.
Look for: which methods correlate with high effectiveness, subjects needing more time, trends in mood/burnout.
If details are missing (how long, what subject, what method, how it went), ask for them casually.
Start your response with "Analyzer:". Be data-driven. If limited history is available, note that and offer general insights. Max 60 words.`,

  critic: `You are the Critic/Optimizer Agent in a multi-agent AI study planning system.
Your role: Review the student's current approach and suggest concrete improvements.
Focus on: sustainable workload, schedule gaps, method effectiveness, preventing burnout.
Start your response with "Optimizer:". Be warm, constructive, and brief. Max 80 words.`,
};

const CRITIC_REVIEW_PROMPT = `You are the Critic/Optimizer Agent reviewing a DRAFT response from other agents before it reaches the student.
Your task: Check if the combined agent response is high quality, actionable, and complete.
If it looks good, reply with exactly: APPROVED
If it needs revision, reply with a single improved version that starts with "⚙️ Optimizer:" and merges the best parts.
Keep the revision under 150 words total.`;

const ORCHESTRATOR_PROMPT = `You are the Orchestrator of a multi-agent AI study planning system.
You have received responses from specialist agents. Your job is to:
1. Weave the agent outputs into a single, cohesive, well-formatted reply for the student.
2. Remove any redundancy. Fix any contradiction between agents.
3. Add a brief warm closing line encouraging the student.
Do NOT add new advice — only format and integrate what the agents said.
Max 100 words total`;

async function callClaude(systemPrompt, messages, userText, syllabus = null, syllabusName = "") {
  const userContent = syllabus
    ? [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: syllabus } },
        { type: "text", text: userText + (syllabusName ? `\n\n[Syllabus uploaded: ${syllabusName}]` : "") },
      ]
    : userText;

  const apiMessages = [
    ...messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userContent },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, messages: apiMessages }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.map((b) => b.text || "").join("") || "";
}

async function runPipeline(userText, history, syllabus, syllabusName, onStep) {
  onStep("Thinking...");
  let agentKeys = ["planner"];
  try {
    const classifyResponse = await callClaude(CLASSIFIER_PROMPT, [], userText, syllabus, syllabusName);
    const parsed = JSON.parse(classifyResponse.replace(/```json|```/g, "").trim());
    if (Array.isArray(parsed.agents) && parsed.agents.length > 0) {
      agentKeys = parsed.agents.filter((k) => AGENT_PROMPTS[k]);
    }
  } catch {
    const lower = userText.toLowerCase();
    agentKeys = [];
    if (/schedul|plan|exam|week|hour|time/i.test(lower)) agentKeys.push("planner");
    if (/method|technique|recall|flashcard|pomodoro|how to study/i.test(lower)) agentKeys.push("strategy");
    if (/studied|session|log|spent|felt|effective/i.test(lower)) agentKeys.push("feedback");
    if (/working|pattern|progress|best method|analyz/i.test(lower)) agentKeys.push("analyzer");
    if (/burn|optim|improve|review|sustainable|not working/i.test(lower)) agentKeys.push("critic");
    if (agentKeys.length === 0) agentKeys = ["planner", "strategy"];
  }

  onStep("Crafting your response...");
  const agentResults = await Promise.all(
    agentKeys.map((key) =>
      callClaude(AGENT_PROMPTS[key], history, userText, syllabus, syllabusName).catch(
        () => `(Agent unavailable, please try again.)`
      )
    )
  );
  const combinedDraft = agentResults.join("\n\n");

  onStep("Reviewing...");
  let finalDraft = combinedDraft;
  try {
    const criticReview = await callClaude(CRITIC_REVIEW_PROMPT, [], `Student message: "${userText}"\n\nDraft agent responses:\n${combinedDraft}`);
    if (!criticReview.trim().toUpperCase().startsWith("APPROVED")) finalDraft = criticReview.trim();
  } catch { /* use draft as-is */ }

  onStep("Almost ready...");
  let reply = finalDraft;
  try {
    const orchestrated = await callClaude(ORCHESTRATOR_PROMPT, [], `Student message: "${userText}"\n\nAgent outputs to integrate:\n${finalDraft}`);
    reply = orchestrated.trim() || finalDraft;
  } catch { reply = finalDraft; }

  return { reply, agentKeys };
}

const QUICK_ACTIONS = [
  { icon: "📅", label: "Build my schedule", prompt: "I need a study schedule. Can you help me build one?" },
  { icon: "🧠", label: "Study methods", prompt: "What study methods would work best for me?" },
  { icon: "📝", label: "Log a session", prompt: "I just finished a study session and want to log it." },
  { icon: "📊", label: "My progress", prompt: "How am I doing? What patterns do you see in my study habits?" },
  { icon: "⚙️", label: "Optimize my plan", prompt: "I'm feeling burnt out. Can you help me optimize my study approach?" },
];

function Message({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 20,
      gap: 12,
      alignItems: "flex-end",
      animation: "msgIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both",
    }}>
      {!isUser && (
        <div style={{
          width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, boxShadow: "0 0 16px #3b82f644",
        }}>✦</div>
      )}
      <div style={{
        maxWidth: "75%",
        background: isUser
          ? "linear-gradient(135deg, #3b82f6cc, #6d28d9cc)"
          : "rgba(255,255,255,0.04)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: isUser ? "1px solid rgba(99,102,241,0.4)" : "1px solid rgba(255,255,255,0.08)",
        borderRadius: isUser ? "20px 20px 4px 20px" : "20px 20px 20px 4px",
        padding: "12px 16px",
        color: isUser ? "#fff" : "#e2e8f0",
        fontSize: 14,
        lineHeight: 1.75,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        boxShadow: isUser
          ? "0 4px 24px rgba(59,130,246,0.25)"
          : "0 4px 24px rgba(0,0,0,0.2)",
      }}>{msg.content}</div>
      {isUser && (
        <div style={{
          width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
        }}>🎓</div>
      )}
    </div>
  );
}

function TypingIndicator({ step }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 20 }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16, boxShadow: "0 0 16px #3b82f644",
      }}>✦</div>
      <div style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "20px 20px 20px 4px",
        padding: "12px 18px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
        <span style={{ color: "#64748b", fontSize: 12 }}>{step}</span>
      </div>
    </div>
  );
}

export default function StudyPlannerApp() {
  const [messages, setMessages] = useState([{
    role: "assistant",
    content: "Hey! 👋 I'm your AI study coach. I'm here to help you build better study habits, create schedules, and figure out what learning strategies work best for you.\n\nTo get started — what are you studying right now, and how's it going?",
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pipelineStep, setPipelineStep] = useState("");
  const [syllabus, setSyllabus] = useState(null);
  const [syllabusName, setSyllabusName] = useState("");
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSyllabusName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setSyllabus(ev.target.result.split(",")[1]);
    reader.readAsDataURL(file);
  };

  const sendMessage = async (text) => {
    const userText = text || input.trim();
    if (!userText || loading) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const userMsg = { role: "user", content: userText };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setLoading(true);
    setPipelineStep("Thinking...");

    const historyForAgents = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const { reply, agentKeys } = await runPipeline(userText, historyForAgents, syllabus, syllabusName, setPipelineStep);
      setMessages([...newHistory, { role: "assistant", content: reply, agentKeys }]);
      if (syllabus) setSyllabus(null);
    } catch (err) {
      setMessages([...newHistory, { role: "assistant", content: "Something went wrong. Please try again.\n\nError: " + err.message }]);
    }

    setLoading(false);
    setPipelineStep("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: #050810;
          font-family: 'DM Sans', sans-serif;
          overflow-x: hidden;
        }

        /* Ambient background orbs */
        body::before {
          content: '';
          position: fixed;
          top: -200px; left: -200px;
          width: 600px; height: 600px;
          background: radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%);
          pointer-events: none;
          z-index: 0;
        }
        body::after {
          content: '';
          position: fixed;
          bottom: -200px; right: -200px;
          width: 600px; height: 600px;
          background: radial-gradient(circle, rgba(139,92,246,0.10) 0%, transparent 70%);
          pointer-events: none;
          z-index: 0;
        }

        @keyframes msgIn {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(59,130,246,0.3); }
          50% { box-shadow: 0 0 40px rgba(139,92,246,0.5); }
        }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 10px; }

        textarea { resize: none; font-family: 'DM Sans', sans-serif; }
        textarea:focus { outline: none; }
        button { cursor: pointer; font-family: 'DM Sans', sans-serif; }
        button:disabled { cursor: not-allowed; }

        .quick-btn {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          color: #94a3b8;
          border-radius: 12px;
          padding: 10px 16px;
          font-size: 13px;
          font-weight: 500;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 8px;
          backdrop-filter: blur(8px);
        }
        .quick-btn:hover {
          background: rgba(59,130,246,0.12);
          border-color: rgba(59,130,246,0.3);
          color: #e2e8f0;
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(59,130,246,0.15);
        }

        .send-btn {
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          border: none;
          border-radius: 12px;
          width: 42px; height: 42px;
          display: flex; align-items: center; justify-content: center;
          color: white;
          font-size: 16px;
          transition: all 0.2s ease;
          flex-shrink: 0;
          animation: pulseGlow 3s ease-in-out infinite;
        }
        .send-btn:hover:not(:disabled) {
          transform: scale(1.05);
          box-shadow: 0 0 24px rgba(139,92,246,0.6);
        }
        .send-btn:disabled {
          background: rgba(255,255,255,0.06);
          animation: none;
          box-shadow: none;
        }

        .input-box {
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 14px 16px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .input-box:focus-within {
          border-color: rgba(59,130,246,0.4);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.08), 0 8px 32px rgba(0,0,0,0.3);
        }

        .logo-glow {
          animation: pulseGlow 4s ease-in-out infinite;
        }

        .title-gradient {
          background: linear-gradient(135deg, #fff 30%, #93c5fd 70%, #c4b5fd 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
      `}</style>

      <div style={{
        position: "relative", zIndex: 1,
        fontFamily: "'DM Sans', sans-serif",
        minHeight: "100vh",
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "0 16px 32px",
      }}>

        {/* Header */}
        <div style={{
          width: "100%", maxWidth: 760,
          padding: "28px 0 20px",
          marginBottom: 8,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", gap: 14,
        }}>
          <div className="logo-glow" style={{
            width: 48, height: 48, borderRadius: 16,
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22,
          }}>✦</div>
          <div>
            <div className="title-gradient" style={{ fontWeight: 700, fontSize: 20, letterSpacing: -0.5 }}>
              Study Coach AI
            </div>
            <div style={{ color: "#475569", fontSize: 12, fontFamily: "'DM Mono', monospace", marginTop: 2 }}>
              personalized · adaptive · smart
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {Object.values(AGENTS).map((a) => (
              <span key={a.label} style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 20,
                background: a.color + "15", color: a.color,
                border: `1px solid ${a.color}30`, fontWeight: 500,
              }}>{a.label}</span>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div style={{
          width: "100%", maxWidth: 760,
          flex: 1,
          minHeight: 300,
          maxHeight: "calc(100vh - 320px)",
          overflowY: "auto",
          padding: "20px 0",
        }}>
          {messages.map((msg, i) => <Message key={i} msg={msg} />)}
          {loading && <TypingIndicator step={pipelineStep} />}
          <div ref={bottomRef} />
        </div>

        {/* Quick actions — only on first load */}
        {messages.length <= 1 && !loading && (
          <div style={{
            width: "100%", maxWidth: 760,
            display: "flex", flexWrap: "wrap", gap: 8,
            marginBottom: 16,
          }}>
            {QUICK_ACTIONS.map((a) => (
              <button key={a.label} className="quick-btn" onClick={() => sendMessage(a.prompt)}>
                <span>{a.icon}</span>{a.label}
              </button>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="input-box" style={{ width: "100%", maxWidth: 760 }}>

          {/* Syllabus badge */}
          {syllabusName && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              marginBottom: 10, padding: "6px 12px",
              background: "rgba(59,130,246,0.1)",
              border: "1px solid rgba(59,130,246,0.2)",
              borderRadius: 10, color: "#60a5fa", fontSize: 12,
            }}>
              📄 <span style={{ flex: 1 }}>{syllabusName}</span>
              <button onClick={() => { setSyllabus(null); setSyllabusName(""); }}
                style={{ background: "none", border: "none", color: "#475569", fontSize: 14, lineHeight: 1 }}>✕</button>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            {/* Attach button */}
            <button
              onClick={() => fileRef.current?.click()}
              title="Upload syllabus PDF"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12, width: 42, height: 42,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#475569", fontSize: 16, flexShrink: 0,
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#94a3b8"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#475569"; }}
            >📎</button>
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handleFileUpload} />

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything about your studies..."
              rows={1}
              style={{
                flex: 1, background: "transparent", border: "none",
                color: "#e2e8f0", fontSize: 14, lineHeight: 1.65,
                padding: "10px 0", maxHeight: 120, overflowY: "auto",
              }}
              onInput={(e) => {
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
            />

            {/* Send button */}
            <button
              className="send-btn"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
            >➤</button>
          </div>

          <div style={{ marginTop: 10, color: "#1e293b", fontSize: 11, textAlign: "center", letterSpacing: 0.3 }}>
            Enter to send · Shift+Enter for new line · 📎 attach syllabus
          </div>
        </div>

      </div>
    </>
  );
}
