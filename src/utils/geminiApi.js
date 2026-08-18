/**
 * Retrieve headers, including the local API key override from browser localStorage if set.
 * Supports overrides for Google Gemini, OpenAI, and Groq.
 */
const getHeaders = () => {
  const headers = { 'Content-Type': 'application/json' };
  
  const geminiKey = localStorage.getItem('gemini_api_key');
  if (geminiKey) headers['x-gemini-key'] = geminiKey;
  
  const openaiKey = localStorage.getItem('openai_api_key');
  if (openaiKey) headers['x-openai-key'] = openaiKey;

  const groqKey = localStorage.getItem('groq_api_key');
  if (groqKey) headers['x-groq-key'] = groqKey;

  return headers;
};

/**
 * Fetch available models for all three direct providers.
 */
export const fetchAvailableModels = async () => {
  const response = await fetch('/api/models', {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to fetch models with status ${response.status}`);
  }
  return await response.json();
};

/**
 * Extract Table of Contents / Outline from parsed document content.
 * Passes provider, model, and fallback configurations to the backend.
 */
export const extractTopicOutline = async (parsedResult, provider, model, allowFallback) => {
  const response = await fetch('/api/outline', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ parsedResult, provider, model, allowFallback }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Outline extraction failed with status ${response.status}`);
  }

  return await response.json();
};

/**
 * Generate detailed notes for a single topic.
 * Passes provider, model, and fallback configurations to the backend.
 */
export const generateTopicNotes = async (topicName, topicDescription, parsedResult, depth, provider, model, allowFallback) => {
  const response = await fetch('/api/notes', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ topicName, topicDescription, parsedResult, depth, provider, model, allowFallback }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Notes generation failed with status ${response.status}`);
  }

  return await response.json();
};

/**
 * Generate Master Summary Cheat-Sheet.
 * Passes provider, model, and fallback configurations to the backend.
 */
export const generateMasterSummary = async (topicsNotes, provider, model, allowFallback) => {
  const response = await fetch('/api/summary', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ topicsNotes, provider, model, allowFallback }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Summary compilation failed with status ${response.status}`);
  }

  return await response.json();
};
