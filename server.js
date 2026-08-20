import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createRequire } from 'module';
import { GROUNDING_RULES, OUTLINE_PROMPT, ANALYZE_DOCUMENT_PROMPT, TOPIC_NOTES_PROMPT, SUMMARY_PROMPT } from './masterExamGuideSpec.js';
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
 * Universal PDF parser helper supporting both pdf-parse v1 (function) and v2 (class)
 */
const parsePdfBuffer = async (buffer) => {
  if (typeof pdfParse === 'function') {
    return await pdfParse(buffer);
  }
  if (pdfParse && typeof pdfParse.default === 'function') {
    return await pdfParse.default(buffer);
  }
  if (pdfParse && pdfParse.PDFParse) {
    const parser = new pdfParse.PDFParse({ data: buffer });
    const res = await parser.getText();
    if (typeof parser.destroy === 'function') {
      await parser.destroy();
    }
    return res;
  }
  throw new Error('Unsupported pdf-parse module interface');
};

/**
 * Server-side PDF text extraction wrapper.
 */
const extractPdfText = async (base64String) => {
  const buffer = Buffer.from(base64String, 'base64');
  const data = await parsePdfBuffer(buffer);
  return data.text || '';
};

/**
 * Extracts pages from PDF separated by form feed (\f)
 */
const extractPdfPagesText = async (base64String) => {
  const buffer = Buffer.from(base64String, 'base64');
  const data = await parsePdfBuffer(buffer);
  const rawPages = (data.text || '').split('\f');
  return rawPages.map((p, idx) => ({
    pageNumber: idx + 1,
    title: `Page ${idx + 1}`,
    content: p.trim()
  })).filter(p => p.content.length > 0);
};

/**
 * Normalizes input document pages from PPTX or PDF
 */
const getSourcePages = async (parsedResult) => {
  if (parsedResult.type === 'pptx') {
    return parsedResult.pages || [];
  } else if (parsedResult.type === 'pdf') {
    return await extractPdfPagesText(parsedResult.base64);
  }
  return [];
};

/**
 * Deterministically chunks pages by page boundaries without exceeding max size
 */
const chunkPages = (pages, maxChunkSize = 80000) => {
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const page of pages) {
    const pageText = `[Page/Slide ${page.pageNumber}: ${page.title}]\n${page.content}\n\n`;
    if (currentLength + pageText.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }
    currentChunk.push(page);
    currentLength += pageText.length;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
};

/**
 * Merges multiple analysis chunks from document-level analysis
 */
const mergeAnalysis = (analyses) => {
  if (analyses.length === 0) return {};
  
  const merged = {
    courseInfo: {
      subjectName: '',
      courseCode: '',
      moduleNumber: '',
      moduleTitle: ''
    },
    officialSyllabus: [],
    courseOutcomes: [],
    assessmentInfo: [],
    references: [],
    chapters: [],
    priorityMap: [],
    importantDefinitions: [],
    importantNumbers: [],
    caseStudies: [],
    tutorialQuestions: [],
    vivaTopics: []
  };

  const chapterMap = new Map();

  analyses.forEach((analysis) => {
    if (analysis.courseInfo) {
      if (!merged.courseInfo.subjectName && analysis.courseInfo.subjectName) merged.courseInfo.subjectName = analysis.courseInfo.subjectName;
      if (!merged.courseInfo.courseCode && analysis.courseInfo.courseCode) merged.courseInfo.courseCode = analysis.courseInfo.courseCode;
      if (!merged.courseInfo.moduleNumber && analysis.courseInfo.moduleNumber) merged.courseInfo.moduleNumber = analysis.courseInfo.moduleNumber;
      if (!merged.courseInfo.moduleTitle && analysis.courseInfo.moduleTitle) merged.courseInfo.moduleTitle = analysis.courseInfo.moduleTitle;
    }

    if (Array.isArray(analysis.officialSyllabus)) merged.officialSyllabus.push(...analysis.officialSyllabus);
    if (Array.isArray(analysis.courseOutcomes)) merged.courseOutcomes.push(...analysis.courseOutcomes);
    if (Array.isArray(analysis.assessmentInfo)) merged.assessmentInfo.push(...analysis.assessmentInfo);
    if (Array.isArray(analysis.references)) merged.references.push(...analysis.references);
    if (Array.isArray(analysis.priorityMap)) merged.priorityMap.push(...analysis.priorityMap);
    if (Array.isArray(analysis.importantDefinitions)) merged.importantDefinitions.push(...analysis.importantDefinitions);
    if (Array.isArray(analysis.importantNumbers)) merged.importantNumbers.push(...analysis.importantNumbers);
    if (Array.isArray(analysis.caseStudies)) merged.caseStudies.push(...analysis.caseStudies);
    if (Array.isArray(analysis.tutorialQuestions)) merged.tutorialQuestions.push(...analysis.tutorialQuestions);
    if (Array.isArray(analysis.vivaTopics)) merged.vivaTopics.push(...analysis.vivaTopics);

    if (Array.isArray(analysis.chapters)) {
      analysis.chapters.forEach(ch => {
        const chName = ch.unit || ch.chapterName || '';
        if (!chName) return;
        if (chapterMap.has(chName)) {
          const existing = chapterMap.get(chName);
          if (Array.isArray(ch.topics)) {
            ch.topics.forEach(topic => {
              if (!existing.topics.some(t => t.name.toLowerCase() === topic.name.toLowerCase())) {
                existing.topics.push(topic);
              }
            });
          }
        } else {
          const newCh = { unit: chName, topics: Array.isArray(ch.topics) ? [...ch.topics] : [] };
          merged.chapters.push(newCh);
          chapterMap.set(chName, newCh);
        }
      });
    }
  });

  merged.officialSyllabus = [...new Set(merged.officialSyllabus)];
  merged.courseOutcomes = [...new Set(merged.courseOutcomes)];
  merged.assessmentInfo = [...new Set(merged.assessmentInfo)];
  merged.references = [...new Set(merged.references)];

  const defMap = new Map();
  merged.importantDefinitions.forEach(d => {
    if (d.concept && d.definition) defMap.set(d.concept.toLowerCase(), d);
  });
  merged.importantDefinitions = [...defMap.values()];

  const numMap = new Map();
  merged.importantNumbers.forEach(n => {
    if (n.number && n.context) numMap.set(n.number.toLowerCase() + n.context.toLowerCase(), n);
  });
  merged.importantNumbers = [...numMap.values()];

  const priorityDedupped = new Map();
  merged.priorityMap.forEach(p => {
    if (p.topic) priorityDedupped.set(p.topic.toLowerCase(), p);
  });
  merged.priorityMap = [...priorityDedupped.values()];

  const csMap = new Map();
  merged.caseStudies.forEach(cs => {
    if (cs.title) csMap.set(cs.title.toLowerCase(), cs);
  });
  merged.caseStudies = [...csMap.values()];

  const tutMap = new Map();
  merged.tutorialQuestions.forEach(t => {
    if (t.question) tutMap.set(t.question.toLowerCase(), t);
  });
  merged.tutorialQuestions = [...tutMap.values()];

  const vivaMap = new Map();
  merged.vivaTopics.forEach(v => {
    if (v.topic) vivaMap.set(v.topic.toLowerCase(), v);
  });
  merged.vivaTopics = [...vivaMap.values()];

  return merged;
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

// 0. DOCUMENT ANALYSIS ENDPOINT
app.post('/api/analyze-document', async (req, res) => {
  const { parsedResult, provider, model, allowFallback } = req.body;

  if (!provider || !model || !parsedResult) {
    return res.status(400).json({ error: { message: 'Missing parameters. Required: provider, model, parsedResult.' } });
  }

  try {
    const pages = await getSourcePages(parsedResult);
    const chunks = chunkPages(pages, 80000);
    const analyses = [];
    
    const keys = {
      gemini: req.headers['x-gemini-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY,
      openai: req.headers['x-openai-key'] || process.env.OPENAI_API_KEY,
      groq: req.headers['x-groq-key'] || process.env.GROQ_API_KEY
    };

    let meta = {};

    for (const chunk of chunks) {
      const chunkText = chunk.map(p => `[Page/Slide ${p.pageNumber}: ${p.title}]\n${p.content}`).join('\n\n');
      const chunkPrompt = `
${GROUNDING_RULES}

${ANALYZE_DOCUMENT_PROMPT}

[SOURCE MATERIAL]
---
${chunkText}
---
`;

      const result = await callLLMWithRetryAndFallback(
        chunkPrompt,
        keys,
        null,
        true,
        provider,
        model,
        allowFallback !== false
      );

      const parsed = safeParseJson(result.text);
      analyses.push(parsed);
      meta = {
        providerUsed: result.providerUsed,
        modelUsed: result.modelUsed,
        fallbackTriggered: result.fallbackTriggered,
        fallbackMessages: result.fallbackMessages
      };
    }

    const merged = mergeAnalysis(analyses);

    res.json({
      data: merged,
      _meta: meta
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: err.message || 'Error performing document analysis.' } });
  }
});

// 1. OUTLINE EXTRACTION ENDPOINT
app.post('/api/outline', async (req, res) => {
  const { parsedResult, provider, model, allowFallback } = req.body;

  if (!provider || !model || !parsedResult) {
    return res.status(400).json({ error: { message: 'Missing parameters. Required: provider, model, parsedResult.' } });
  }

  try {
    const pages = await getSourcePages(parsedResult);
    const chunks = chunkPages(pages, 80000);
    const outlines = [];
    
    const keys = {
      gemini: req.headers['x-gemini-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY,
      openai: req.headers['x-openai-key'] || process.env.OPENAI_API_KEY,
      groq: req.headers['x-groq-key'] || process.env.GROQ_API_KEY
    };

    let meta = {};

    for (const chunk of chunks) {
      const chunkText = chunk.map(p => `[Page/Slide ${p.pageNumber}: ${p.title}]\n${p.content}`).join('\n\n');
      const chunkPrompt = `
${GROUNDING_RULES}

${OUTLINE_PROMPT}

[SOURCE MATERIAL]
---
${chunkText}
---
`;

      const result = await callLLMWithRetryAndFallback(
        chunkPrompt,
        keys,
        null,
        true,
        provider,
        model,
        allowFallback !== false
      );

      const parsed = safeParseJson(result.text);
      outlines.push(parsed);
      meta = {
        providerUsed: result.providerUsed,
        modelUsed: result.modelUsed,
        fallbackTriggered: result.fallbackTriggered,
        fallbackMessages: result.fallbackMessages
      };
    }

    // Merge outlines
    let mergedSyllabusLines = '';
    const mergedUnits = [];
    const unitMap = new Map();

    outlines.forEach(out => {
      if (out.syllabusLines && out.syllabusLines !== 'Official syllabus lines were not present in the uploaded presentation.') {
        if (mergedSyllabusLines) {
          mergedSyllabusLines += '\n' + out.syllabusLines;
        } else {
          mergedSyllabusLines = out.syllabusLines;
        }
      }
      
      if (out.units && Array.isArray(out.units)) {
        out.units.forEach(u => {
          const uName = u.unit.trim();
          if (unitMap.has(uName)) {
            const existing = unitMap.get(uName);
            if (u.topics && Array.isArray(u.topics)) {
              u.topics.forEach(t => {
                if (!existing.topics.some(existingTopic => existingTopic.name.toLowerCase() === t.name.toLowerCase())) {
                  existing.topics.push(t);
                }
              });
            }
          } else {
            const newUnit = { unit: uName, topics: u.topics ? [...u.topics] : [] };
            mergedUnits.push(newUnit);
            unitMap.set(uName, newUnit);
          }
        });
      }
    });

    if (!mergedSyllabusLines) {
      mergedSyllabusLines = 'Official syllabus lines were not present in the uploaded presentation.';
    }

    res.json({
      data: mergedUnits,
      syllabusLines: mergedSyllabusLines,
      _meta: meta
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: err.message || 'Error extracting syllabus outline.' } });
  }
});

// 2. NOTES GENERATION ENDPOINT
app.post('/api/notes', async (req, res) => {
  const { topicName, topicDescription, depth, provider, model, allowFallback, parsedResult, topicPages, domainType } = req.body;

  if (!topicName || !provider || !model || !parsedResult) {
    return res.status(400).json({ error: { message: 'Missing parameters. Required: topicName, provider, model, parsedResult.' } });
  }

  try {
    const pages = await getSourcePages(parsedResult);
    let relevantPages = [];

    if (topicPages && Array.isArray(topicPages) && topicPages.length > 0) {
      // Extract pages in topicPages, plus 1 before and 1 after buffer
      const pageNumbersToInclude = new Set();
      topicPages.forEach(p => {
        pageNumbersToInclude.add(p);
        if (p > 1) pageNumbersToInclude.add(p - 1);
        pageNumbersToInclude.add(p + 1);
      });
      relevantPages = pages.filter(p => pageNumbersToInclude.has(p.pageNumber));
    }

    if (relevantPages.length === 0) {
      relevantPages = pages;
    }

    const sourceText = relevantPages.map(p => `[Page/Slide ${p.pageNumber}: ${p.title}]\n${p.content}`).join('\n\n');

    const effectiveDomainType = domainType || 'mixed';
    const prompt = `
${GROUNDING_RULES}

${TOPIC_NOTES_PROMPT.replace(/{topicName}/g, topicName).replace(/{depth}/g, depth || 'standard').replace(/{domainType}/g, effectiveDomainType)}

[SOURCE MATERIAL]
---
${sourceText}
---
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
    // Build a richer summary input that includes memory tricks, definitions, key points, and exam questions
    const topicsSummaryData = topicsNotes.map(n => ({
      topicName: n.topicName,
      definition: (n.definitions && n.definitions.length > 0) ? n.definitions[0] : (n.sourceContent?.content?.substring(0, 200) || ''),
      priority: n.priority?.level || n.priority || 'MEDIUM',
      keyPoints: (n.keyPoints || []).slice(0, 5),
      memoryTricks: n.memoryTricks || [],
      examTips: (n.examTips || []).slice(0, 3),
      hasFormula: !!(n.workedExample && n.workedExample.formula),
      hasDiagram: !!(n.diagram && n.diagram.svg),
      hasCode: !!(n.codeExample && n.codeExample.code),
      hasCaseStudy: !!(n.caseStudy && n.caseStudy.title)
    }));

    const prompt = `
${GROUNDING_RULES}

${SUMMARY_PROMPT.replace('{topicsNotesJson}', JSON.stringify(topicsSummaryData))}
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
