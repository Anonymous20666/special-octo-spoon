// core/ai.js
const axios = require('axios');
const logger = require('./logger');
const { ai } = require('../config');

const { getMemory, updateMemory } = require('./ai.memory');
const { AGENTS, detectIntent } = require('./ai.agents');
const { tools } = require('./ai.tools');

// 🌟 THE ULTIMATE FREE MODEL FALLBACK ARRAY
const FREE_MODELS = [
    'qwen/qwen3.6-plus-preview:free',
    'google/gemma-7b-it:free',
    'huggingfaceh4/zephyr-7b-beta:free',
    'mistralai/mistral-7b-instruct:free', 
    'undi95/toppy-m-7b:free',
    'openchat/openchat-7b:free'
];

// 🧠 Build system prompt
function buildSystemPrompt(agentKeys, memory) {
    const agentText = agentKeys.map(a => AGENTS[a]).join('\n');
    const memoryText = memory.length
        ? memory.map(m => `User: ${m.user}\nAI: ${m.ai}`).join('\n')
        : '';
        
    return `
You are OMEGA, an advanced multi-agent AI system.

Agents active:
${agentText}

Rules:
- Be natural and human-like
- Be concise
- Think like a real expert team
- If needed, suggest using tools

Context:
${memoryText}
`;
}

// 🔧 Tool matcher
async function tryToolUse(prompt) {
    for (const tool of tools) {
        if (prompt.toLowerCase().includes(tool.name.toLowerCase())) {
            return await tool.execute();
        }
    }
    return null;
}

async function generateText(prompt, userId = 'global') {
    const apiKey = ai.openRouterKey;
    if (!apiKey) throw new Error("Missing API key");

    try {
        // 🔧 Try tool execution first
        const toolResult = await tryToolUse(prompt);
        if (toolResult) {
            return `🛠 **Tool Executed:**\n\`\`\`json\n${JSON.stringify(toolResult, null, 2)}\n\`\`\``;
        }

        // 🧠 Detect agents based on prompt
        const agents = detectIntent(prompt);
        // 💾 Fetch user's fast Redis conversation memory
        const memory = await getMemory(userId);
        const systemPrompt = buildSystemPrompt(agents, memory);

        let lastErrorDetails = "";

        // 🔄 FAST-FAIL AUTOMATIC FALLBACK ENGINE
        for (const currentModel of FREE_MODELS) {
            try {
                const response = await axios.post(
                    'https://openrouter.ai/api/v1/chat/completions',
                    {
                        model: currentModel,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.7,
                        max_tokens: 1500
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${apiKey}`,
                            'Content-Type': 'application/json',
                            'HTTP-Referer': 'https://github.com/pappy-ultimate', 
                            'X-Title': 'Omega Elite Bot'
                        },
                        // 👈 NEW: AGGRESSIVE TIMEOUT (6 Seconds)
                        // If the model is slow, instantly kill the request and move to the next!
                        timeout: 6000 
                    }
                );

                const reply = response.data.choices[0].message.content;

                // Save new interaction to Redis
                await updateMemory(userId, prompt, reply);
                
                return `🧠 *[ ${agents.join(', ').toUpperCase()} ]*\n\n${reply}`;

            } catch (err) {
                // Determine if it was a timeout or an actual API error
                const isTimeout = err.code === 'ECONNABORTED';
                lastErrorDetails = isTimeout ? "Timeout exceeded 6s" : (err.response?.data ? JSON.stringify(err.response.data) : err.message);
                
                logger.warn(`[AI] Model ${currentModel} failed (${isTimeout ? 'Too Slow' : 'Offline'}). Swapping to next...`);
                continue; // Instantly jumps to the next model in the list
            }
        }

        // 🚨 If the loop finishes and ALL models failed
        logger.error("Multi-Agent AI Error (ALL FREE MODELS EXHAUSTED):", lastErrorDetails);
        throw new Error("All free AI models are currently overloaded. Please try again in a few moments.");

    } catch (globalErr) {
        throw globalErr; 
    }
}

module.exports = { generateText };
