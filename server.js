import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Set request limits high enough to handle large base64 PDF uploads
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));
app.use(cors());

// Complete direct providers model catalog with metadata for UI
const PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    models: [
      {
        id: 'gemini-3.6-flash',
        displayName: 'Gemini 3.6 Flash',
        description: 'Recommended — High intelligence, fast, PDF/multimodal capable.',
        quality: 'High',
        speed: 'Very Fast',
        bestUseCase: 'detailed study guides',
        pdfSupported: true,
        recommended: true
      },
      {
        id: 'gemini-3.5-flash',
        displayName: 'Gemini 3.5 Flash',
        description: 'Advanced reasoning, general purpose, PDF capable.',
        quality: 'High',
        speed: 'Very Fast',
        bestUseCase: 'complex reasoning',
        pdfSupported: true,
        recommended: false
      },
      {
        id: 'gemini-3.5-flash-lite',
        displayName: 'Gemini 3.5 Flash-Lite',
        description: 'Fastest/cost-efficient, document extraction, PDF capable.',
        quality: 'High',
        speed: 'Very Fast',
        bestUseCase: 'fast document processing',
        pdfSupported: true,
        recommended: false
      },
      {
        id: 'gemini-3.1-flash-lite',
        displayName: 'Gemini 3.1 Flash-Lite',
        description: 'Efficient, high-throughput, PDF capable.',
        quality: 'High',
        speed: 'Very Fast',
        bestUseCase: 'cost-efficient generation',
        pdfSupported: true,
        recommended: false
      }
    ]
  },
  openai: {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    models: [
      {
        id: 'gpt-4o',
        displayName: 'GPT-4o',
        description: 'OpenAI flagship model — High reasoning and intelligence.',
        quality: 'Very High',
        speed: 'Fast',
        bestUseCase: 'complex reasoning',
        pdfSupported: false,
        recommended: false
      },
      {
        id: 'gpt-4o-mini',
        displayName: 'GPT-4o-Mini',
        description: 'Fast, highly capable, and extremely cost-efficient.',
        quality: 'High',
        speed: 'Very Fast',
        bestUseCase: 'detailed study guides',
        pdfSupported: false,
        recommended: true
      },
      {
        id: 'o1-mini',
        displayName: 'o1-Mini',
        description: 'Fast reasoning model optimized for coding and STEM logic.',
        quality: 'Very High',
        speed: 'Moderate',
        bestUseCase: 'deep logic & math',
        pdfSupported: false,
        recommended: false
      }
    ]
  },
  groq: {
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        displayName: 'Llama 3.3 70B Versatile',
        description: 'High capability open model with deep logical reasoning.',
        quality: 'High',
        speed: 'Very Fast',
        bestUseCase: 'detailed study guides',
        pdfSupported: false,
        recommended: true
      },
      {
        id: 'mixtral-8x7b-32768',
        displayName: 'Mixtral 8x7B',
        description: 'Efficient MoE architecture with a large context window.',
        quality: 'High',
        speed: 'Very Fast',
        bestUseCase: 'fast document processing',
        pdfSupported: false,
        recommended: false
      }
    ]
  }
};

/**
 * Server-side PDF text extraction wrapper.
 */
const extractPdfText = async (base64String) => {
  const buffer = Buffer.from(base64String, 'base64');
  const data = await pdfParse(buffer);
  return data.text || '';
};

/**
 * Check if API Key is set for at least one provider
 */
app.use((req, res, next) => {
  const geminiKey = req.headers['x-gemini-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY;
  const openaiKey = req.headers['x-openai-key'] || process.env.OPENAI_API_KEY;
  const groqKey = req.headers['x-groq-key'] || process.env.GROQ_API_KEY;

  const hasGemini = geminiKey && geminiKey !== 'your_actual_gemini_api_key_here';
  const hasOpenai = openaiKey && openaiKey !== 'your_openai_api_key_here';
  const hasGroq = groqKey && groqKey !== 'your_groq_api_key_here';

  if (!hasGemini && !hasOpenai && !hasGroq) {
    return res.status(401).json({
      error: {
        message: 'No valid API key configured. Please supply a local override key in the UI settings or set a key in the server environment.'
      }
    });
  }
  next();
});

/**
 * Cleans markdown JSON wrapping code blocks and fixes common LLM JSON issues.
 */
const cleanJsonString = (str) => {
  let cleaned = str.trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?\s*```\s*$/, '');
  }
  cleaned = cleaned.trim();

  // Strip any leading text before the first JSON structure
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let jsonStart = -1;
  if (firstBrace !== -1 && firstBracket !== -1) {
    jsonStart = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    jsonStart = firstBrace;
  } else if (firstBracket !== -1) {
    jsonStart = firstBracket;
  }
  if (jsonStart > 0) {
    cleaned = cleaned.substring(jsonStart);
  }

  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  return cleaned.trim();
};

/**
 * Safely parse a JSON string from LLM output, attempting repairs for common issues.
 */
const safeParseJson = (rawText) => {
  const cleaned = cleanJsonString(rawText);
  
  // First attempt: direct parse
  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    console.warn('Initial JSON parse failed, attempting repair:', firstErr.message);
  }

  // Attempt to fix unescaped control characters inside JSON string values
  let repaired = cleaned.replace(/[\x00-\x1F\x7F]/g, (ch) => {
    if (ch === '\n') return '\\n';
    if (ch === '\r') return '\\r';
    if (ch === '\t') return '\\t';
    return '';
  });

  try {
    return JSON.parse(repaired);
  } catch (secondErr) {
    console.warn('Second JSON parse failed, attempting brace balancing:', secondErr.message);
  }

  // Attempt to balance unclosed braces/brackets (truncated output)
  let opens = 0, closesNeeded = [];
  for (const ch of repaired) {
    if (ch === '{') { opens++; closesNeeded.push('}'); }
    else if (ch === '[') { opens++; closesNeeded.push(']'); }
    else if (ch === '}' || ch === ']') { opens--; closesNeeded.pop(); }
  }
  if (closesNeeded.length > 0) {
    repaired += closesNeeded.reverse().join('');
  }

  // Final attempt
  try {
    return JSON.parse(repaired);
  } catch (finalErr) {
    throw new Error(`Failed to parse AI response as JSON after repair attempts: ${finalErr.message}`);
  }
};


/**
 * Discover and filter models for each direct provider.
 */
app.get('/api/models', async (req, res) => {
  const geminiKey = req.headers['x-gemini-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY;
  const openaiKey = req.headers['x-openai-key'] || process.env.OPENAI_API_KEY;
  const groqKey = req.headers['x-groq-key'] || process.env.GROQ_API_KEY;

  const results = [];

  // 1. Google Gemini Models
  if (geminiKey && geminiKey !== 'your_actual_gemini_api_key_here') {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${geminiKey}`);
      if (response.ok) {
        const data = await response.json();
        const apiModelNames = (data.models || []).map(m => m.name.replace(/^models\//, ''));
        PROVIDERS.gemini.models.forEach(model => {
          const isAvailable = apiModelNames.some(name => name.includes(model.id));
          results.push({ ...model, provider: 'gemini', isAvailable });
        });
      } else {
        PROVIDERS.gemini.models.forEach(model => {
          results.push({ ...model, provider: 'gemini', isAvailable: true });
        });
      }
    } catch (e) {
      PROVIDERS.gemini.models.forEach(model => {
        results.push({ ...model, provider: 'gemini', isAvailable: true });
      });
    }
  } else {
    PROVIDERS.gemini.models.forEach(model => {
      results.push({ ...model, provider: 'gemini', isAvailable: false });
    });
  }

  // 2. OpenAI Models
  if (openaiKey && openaiKey !== 'your_openai_api_key_here') {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${openaiKey}` }
      });
      if (response.ok) {
        const data = await response.json();
        const apiModelNames = (data.data || []).map(m => m.id);
        PROVIDERS.openai.models.forEach(model => {
          const isAvailable = apiModelNames.some(name => name.includes(model.id));
          results.push({ ...model, provider: 'openai', isAvailable });
        });
      } else {
        PROVIDERS.openai.models.forEach(model => {
          results.push({ ...model, provider: 'openai', isAvailable: true });
        });
      }
    } catch (e) {
      PROVIDERS.openai.models.forEach(model => {
        results.push({ ...model, provider: 'openai', isAvailable: true });
      });
    }
  } else {
    PROVIDERS.openai.models.forEach(model => {
      results.push({ ...model, provider: 'openai', isAvailable: false });
    });
  }

  // 3. Groq Models
  if (groqKey && groqKey !== 'your_groq_api_key_here') {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${groqKey}` }
      });
      if (response.ok) {
        const data = await response.json();
        const apiModelNames = (data.data || []).map(m => m.id);
        PROVIDERS.groq.models.forEach(model => {
          const isAvailable = apiModelNames.some(name => name.includes(model.id));
          results.push({ ...model, provider: 'groq', isAvailable });
        });
      } else {
        PROVIDERS.groq.models.forEach(model => {
          results.push({ ...model, provider: 'groq', isAvailable: true });
        });
      }
    } catch (e) {
      PROVIDERS.groq.models.forEach(model => {
        results.push({ ...model, provider: 'groq', isAvailable: true });
      });
    }
  } else {
    PROVIDERS.groq.models.forEach(model => {
      results.push({ ...model, provider: 'groq', isAvailable: false });
    });
  }

  res.json(results);
});

/**
 * REST fetch handler for Google Gemini API.
 */
const callGeminiAPI = async (prompt, apiKey, inlineData = null, responseSchema = null, model = 'gemini-3.6-flash') => {
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
  
  const parts = [];
  if (inlineData) {
    parts.push({
      inlineData: {
        mimeType: inlineData.mimeType,
        data: inlineData.data
      }
    });
  }
  parts.push({ text: prompt });

  const isGemini3x = model.startsWith('gemini-3.');
  const requestBody = {
    contents: [{ parts }],
    generationConfig: {}
  };

  if (!isGemini3x) {
    requestBody.generationConfig.temperature = 0.2;
  }

  if (responseSchema) {
    requestBody.generationConfig.responseMimeType = "application/json";
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const msg = errorData.error?.message || `Gemini API returned status ${response.status}`;
    const err = new Error(msg);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) {
    throw new Error('Empty response received from Gemini API.');
  }

  return textResponse;
};

/**
 * REST fetch handler for OpenAI or Groq Chat Completion endpoints.
 */
const callOpenAICompatibleAPI = async (url, model, apiKey, prompt, responseSchema = null) => {
  const messages = [
    { role: 'user', content: prompt }
  ];

  const body = {
    model,
    messages,
    temperature: 0.2
  };

  if (responseSchema) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const msg = errorData.error?.message || `API returned status ${response.status}`;
    const err = new Error(msg);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const textResponse = data.choices?.[0]?.message?.content;
  if (!textResponse) {
    throw new Error('Empty response received from API.');
  }

  return textResponse;
};

/**
 * Provider-agnostic LLM request router with backoff retry + cross-provider fallback logic.
 */
const callLLMWithRetryAndFallback = async (prompt, keys, inlineData, responseSchema, requestedProvider, requestedModel, allowFallback = true) => {
  const maxRetries = 3;
  const baseDelayMs = 1000;
  const maxDelayMs = 8000;

  // Fallback chain across providers: Gemini -> OpenAI -> Groq
  const fallbackChain = [
    { provider: 'gemini', model: 'gemini-3.6-flash' },
    { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' }
  ];

  let currentProvider = requestedProvider;
  let currentModel = requestedModel;
  let attempt = 0;
  
  let chainIndex = fallbackChain.findIndex(item => item.provider === currentProvider && item.model === currentModel);
  if (chainIndex === -1) chainIndex = 0;

  const fallbackMessages = [];

  while (true) {
    const currentApiKey = keys[currentProvider];
    const isKeySet = currentApiKey && currentApiKey !== 'your_actual_gemini_api_key_here' && currentApiKey !== 'your_openai_api_key_here' && currentApiKey !== 'your_groq_api_key_here';

    if (!isKeySet) {
      if (allowFallback && chainIndex < fallbackChain.length - 1) {
        const prevP = currentProvider;
        const prevM = currentModel;
        chainIndex++;
        currentProvider = fallbackChain[chainIndex].provider;
        currentModel = fallbackChain[chainIndex].model;
        fallbackMessages.push(`Skipped ${prevP}/${prevM} (API key not configured). Switched to fallback ${currentProvider}/${currentModel}.`);
        continue;
      }
      throw new Error(`API key for ${currentProvider} is not configured.`);
    }

    try {
      let text = '';
      if (currentProvider === 'gemini') {
        text = await callGeminiAPI(prompt, currentApiKey, inlineData, responseSchema, currentModel);
      } else if (currentProvider === 'openai') {
        const url = 'https://api.openai.com/v1/chat/completions';
        text = await callOpenAICompatibleAPI(url, currentModel, currentApiKey, prompt, responseSchema);
      } else if (currentProvider === 'groq') {
        const url = 'https://api.groq.com/openai/v1/chat/completions';
        text = await callOpenAICompatibleAPI(url, currentModel, currentApiKey, prompt, responseSchema);
      }

      return {
        text,
        providerUsed: currentProvider,
        modelUsed: currentModel,
        fallbackTriggered: fallbackMessages.length > 0,
        fallbackMessages
      };
    } catch (error) {
      const status = error.status;
      const isRetryable = status === 503 || status === 429 || status === 500;

      if (!isRetryable || attempt >= maxRetries) {
        if (allowFallback && chainIndex < fallbackChain.length - 1) {
          const prevP = currentProvider;
          const prevM = currentModel;
          chainIndex++;
          currentProvider = fallbackChain[chainIndex].provider;
          currentModel = fallbackChain[chainIndex].model;
          attempt = 0; // Reset retry counter for fallback model
          
          fallbackMessages.push(
            `Model ${prevP}/${prevM} failed with status ${status || 'Error'}. Continuing with fallback ${currentProvider}/${currentModel}.`
          );
          
          console.warn(`Fallback triggered: switching from ${prevP}/${prevM} to ${currentProvider}/${currentModel}`);
          continue;
        }
        throw error;
      }

      attempt++;
      const backoffDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const jitter = Math.random() * 500;
      const sleepTime = backoffDelay + jitter;

      console.warn(`Attempt ${attempt} for model ${currentProvider}/${currentModel} failed (status ${status}). Retrying in ${Math.round(sleepTime)}ms...`);
      await new Promise(resolve => setTimeout(resolve, sleepTime));
    }
  }
};

/**
 * Extracts prompt based on PDF capabilities. If model does not support PDF directly, we parse it to raw text.
 */
const prepareModelPromptAndInputs = async (req, promptTemplate, isOutline = false) => {
  const { parsedResult, provider, model } = req.body;

  // Determine if the selected model supports PDF
  const providerConfig = PROVIDERS[provider];
  const modelConfig = providerConfig?.models.find(m => m.id === model);
  const pdfSupported = modelConfig ? modelConfig.pdfSupported : false;

  let prompt = '';
  let inlineData = null;

  if (parsedResult.type === 'pdf') {
    if (pdfSupported) {
      inlineData = {
        mimeType: 'application/pdf',
        data: parsedResult.base64
      };
      prompt = promptTemplate;
    } else {
      // PDF to Text fallback extraction
      const extractedText = await extractPdfText(parsedResult.base64);
      prompt = `
[SOURCE MATERIAL - PDF TEXT CONTENT]
---
${extractedText.substring(0, 85000)}
---

Using the above PDF text content as the source of truth, fulfill this task:
${promptTemplate}
`;
    }
  } else {
    // PPTX text input
    const contentSummary = parsedResult.pages
      .map(p => `[Slide ${p.pageNumber}: ${p.title}]\n${p.content}`)
      .join('\n\n');

    prompt = `
[SOURCE MATERIAL - PPTX SLIDES TEXT]
---
${contentSummary.substring(0, 85000)}
---

Using the above PPTX text content as the source of truth, fulfill this task:
${promptTemplate}
`;
  }

  return { prompt, inlineData };
};

// 1. OUTLINE EXTRACTION ENDPOINT
app.post('/api/outline', async (req, res) => {
  const { provider, model, allowFallback } = req.body;

  if (!provider || !model) {
    return res.status(400).json({ error: { message: 'Missing parameters. Required: provider, model.' } });
  }

  try {
    const promptTemplate = `
You are an expert academic curriculum designer.
Analyze the attached course material.
Your goal is to extract a clean, logical Table of Contents / topic outline for a comprehensive study guide based on the document.
Group the content into logical "Units" (or Chapters), and within each Unit, list the specific "Topics".
For each topic, provide a brief 1-sentence description of what it covers.

Output your response strictly as a JSON array of Units, matching this schema:
[
  {
    "unit": "Unit 1: [Unit Name]",
    "topics": [
      {
        "id": "1",
        "name": "[Topic Name]",
        "description": "[1-sentence description of what this topic covers based on the content]"
      }
    ]
  }
]

Ensure you cover the entire document content. Do not invent topics that are not present.
Output ONLY the raw JSON array. Do not wrap it in markdown code blocks.
`;

    const { prompt, inlineData } = await prepareModelPromptAndInputs(req, promptTemplate, true);

    const keys = {
      gemini: req.headers['x-gemini-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY,
      openai: req.headers['x-openai-key'] || process.env.OPENAI_API_KEY,
      groq: req.headers['x-groq-key'] || process.env.GROQ_API_KEY
    };

    const result = await callLLMWithRetryAndFallback(
      prompt,
      keys,
      inlineData,
      true,
      provider,
      model,
      allowFallback !== false
    );

    res.json({
      data: safeParseJson(result.text),
      _meta: {
        providerUsed: result.providerUsed,
        modelUsed: result.modelUsed,
        fallbackTriggered: result.fallbackTriggered,
        fallbackMessages: result.fallbackMessages
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: err.message || 'Error extracting syllabus outline.' } });
  }
});

// 2. NOTES GENERATION ENDPOINT
app.post('/api/notes', async (req, res) => {
  const { topicName, topicDescription, depth, provider, model, allowFallback } = req.body;

  if (!topicName || !provider || !model) {
    return res.status(400).json({ error: { message: 'Missing parameters. Required: topicName, provider, model.' } });
  }

  try {
    const promptTemplate = `
You are an expert college professor in STEM and Computer Science.
Generate highly detailed, comprehensive exam-ready study notes for the topic: "${topicName}" (${topicDescription || ''}).
Use the source material as the primary source of truth, expanding on it using standard, correct academic knowledge to ensure absolute completeness.

Target Note Depth: ${depth || 'standard'} (choose depth styling: concise, standard, detailed. Detailed should have maximum elaboration and exhaustive explanations).

You MUST return a JSON object matching this schema. Provide detailed contents for every single field:
{
  "topicName": "${topicName}",
  "definition": "[Detailed explanation written for someone encountering it for the first time. Keep it precise, professional, yet easy to understand.]",
  "whyItMatters": "[Real-world relevance, practical applications, or where this concept is used in industry/engineering.]",
  "howItWorks": [
    "[Step 1 of the working mechanism, detailed]",
    "[Step 2 of the working mechanism, detailed]",
    "[Step 3 (or more) of the working mechanism, detailed]"
  ],
  "complexity": {
    "time": "[Time complexity (e.g. O(1), O(log n)) if applicable; otherwise key quantitative metrics/formulas]",
    "space": "[Space complexity if applicable; otherwise secondary metrics/formulas]",
    "explanation": "[Detailed explanation of why these complexities/metrics/formulas hold true]"
  },
  "codeSnippet": {
    "language": "[Programming language, e.g. javascript, python, cpp, java or 'none' if math/science]",
    "code": "[Clean, highly commented code block illustrating the concept; or a worked numerical/algebraic example if non-programming]",
    "explanation": "[Line-by-line or step-by-step walkthrough of the code or example]"
  },
  "examFocus": [
    "Common Mistake: [Explain a common student pitfall or mistake on this topic]",
    "Exam Trick: [Provide a typical exam question focus or key trick to remember]"
  ],
  "comparisons": [
    {
      "feature": "[Feature to compare, e.g. Speed, Balancing, Memory]",
      "conceptA": "[Details for this concept, ${topicName}]",
      "conceptB": "[Details for a related concept or variant, e.g. standard implementation vs optimized]"
    }
  ],
  "diagramSvg": "[A clean, modern SVG diagram representing the concept's structure, flow, or layout. Use a transparent background. Draw boxes, nodes, text labels, and arrows using clean SVG elements (<svg viewBox=\\"0 0 400 200\\"><rect .../><text .../><line .../></svg>). Keep style inline and use colors from this palette: Accent: #3b82f6 (blue), Muted: #71717a, Text: #fafafa or #09090b depending on light/dark mode. Ensure it is neat and fits within 400x200 viewBox.]"
}

Strictly output ONLY the JSON string. Do not include markdown code blocks.
`;

    const { prompt, inlineData } = await prepareModelPromptAndInputs(req, promptTemplate, false);

    const keys = {
      gemini: req.headers['x-gemini-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY,
      openai: req.headers['x-openai-key'] || process.env.OPENAI_API_KEY,
      groq: req.headers['x-groq-key'] || process.env.GROQ_API_KEY
    };

    const result = await callLLMWithRetryAndFallback(
      prompt,
      keys,
      inlineData,
      true,
      provider,
      model,
      allowFallback !== false
    );

    res.json({
      data: safeParseJson(result.text),
      _meta: {
        providerUsed: result.providerUsed,
        modelUsed: result.modelUsed,
        fallbackTriggered: result.fallbackTriggered,
        fallbackMessages: result.fallbackMessages
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: err.message || 'Error generating detailed notes.' } });
  }
});

// 3. MASTER SUMMARY ENDPOINT
app.post('/api/summary', async (req, res) => {
  const { topicsNotes, provider, model, allowFallback } = req.body;

  if (!topicsNotes || !Array.isArray(topicsNotes) || !provider || !model) {
    return res.status(400).json({ error: { message: 'Missing parameters. Required: topicsNotes, provider, model.' } });
  }

  try {
    const topicsSummaryData = topicsNotes.map(n => ({
      name: n.topicName,
      def: n.definition.substring(0, 150) + '...',
      metric: n.complexity.time || 'N/A'
    }));

    const prompt = `
You are an expert exam advisor. Create a master summary cheat-sheet table summarizing the key facts of these topics:
${JSON.stringify(topicsSummaryData)}

Return a JSON array of objects representing the master summary table:
[
  {
    "topic": "[Topic Name]",
    "coreTakeaway": "[Key 1-sentence definition/takeaway]",
    "criticalMetric": "[Complexity, formulas, or key metric]",
    "examTip": "[Single most important exam tip or formula]"
  }
]

Strictly output ONLY the JSON string. Do not wrap in markdown code blocks.
`;

    const keys = {
      gemini: req.headers['x-gemini-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY,
      openai: req.headers['x-openai-key'] || process.env.OPENAI_API_KEY,
      groq: req.headers['x-groq-key'] || process.env.GROQ_API_KEY
    };

    const result = await callLLMWithRetryAndFallback(
      prompt,
      keys,
      null,
      true,
      provider,
      model,
      allowFallback !== false
    );

    res.json({
      data: safeParseJson(result.text),
      _meta: {
        providerUsed: result.providerUsed,
        modelUsed: result.modelUsed,
        fallbackTriggered: result.fallbackTriggered,
        fallbackMessages: result.fallbackMessages
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: err.message || 'Error creating master summary revision sheet.' } });
  }
});

// Start listening
app.listen(port, () => {
  console.log(`Backend Express server is running on http://localhost:${port}`);
});
