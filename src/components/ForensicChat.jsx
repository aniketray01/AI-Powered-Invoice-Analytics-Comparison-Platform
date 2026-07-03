import React, { useState } from "react";
import { generateSummary } from "../services/summaryService";
import { filterRows } from "../services/filterService";

export default function ForensicChat({ contextData }) {
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const askQuestion = async () => {
        if (!question.trim()) return;

        setIsLoading(true);
        setAnswer("");

        try {
            const data = contextData?.data || [];

            const summary = generateSummary(data);
            const filteredRows = filterRows(data, question);

            const context = `
SUMMARY:
${JSON.stringify(summary, null, 2)}

RELEVANT ROWS:
${JSON.stringify(filteredRows, null, 2)}
`;

            const response = await fetch("/api/openai/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: `
You are a telecom invoice audit assistant.
Use SUMMARY for general insights.
Use RELEVANT ROWS for specific queries.
`
                        },
                        {
                            role: "user",
                            content: `
Context:
${context}

Question:
${question}
`
                        }
                    ]
                })
            });

            const result = await response.json();
            setAnswer(result.choices[0].message.content);

        } catch (error) {
            console.error(error);
            setAnswer("Error fetching answer");
        }

        setIsLoading(false);
    };

    return (
        <div style={{ marginTop: "20px" }}>
            <h3>Invoice Summary Q&A</h3>

            <div style={{ display: 'flex', gap: '8px' }}>
                <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && askQuestion()}
                    placeholder="Ask a question on this summary..."
                    style={{
                        flex: 1,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '10px',
                        padding: '10px 12px',
                        color: 'white',
                        outline: 'none'
                    }}
                />
                <button
                    className="btn-primary"
                    onClick={askQuestion}
                    disabled={isLoading}
                >
                    Ask
                </button>
            </div>

            {isLoading && <p style={{ marginTop: "10px" }}>Thinking...</p>}

            {answer && (
                <div style={{
                    marginTop: "12px",
                    padding: "12px",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "10px"
                }}>
                    <b>Answer:</b>
                    <p>{answer}</p>
                </div>
            )}
        </div>
    );
}