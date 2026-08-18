import React, { useState, useEffect } from 'react';
import { 
  Upload, FileText, CheckCircle, AlertCircle, Trash2, Plus, 
  Edit, Settings, Sun, Moon, FileDown, RotateCw, ChevronUp, 
  ChevronDown, BookOpen, Sparkles, X, Check, FileCode, ArrowLeft
} from 'lucide-react';
import { parseFileContent } from './utils/fileParser';
import { extractTopicOutline, generateTopicNotes, generateMasterSummary, fetchAvailableModels } from './utils/geminiApi';
import { downloadPdfGuide } from './utils/pdfGenerator';

function App() {
  // Theme
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  
  // Local API Key Overrides
  const [geminiKeyInput, setGeminiKeyInput] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [openaiKeyInput, setOpenaiKeyInput] = useState(() => localStorage.getItem('openai_api_key') || '');
  const [groqKeyInput, setGroqKeyInput] = useState(() => localStorage.getItem('groq_api_key') || '');
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [hasKeysToken, setHasKeysToken] = useState(() => Math.random());

  // Multi-LLM Selection States
  const [models, setModels] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState('gemini');
  const [selectedModelId, setSelectedModelId] = useState('gemini-3.6-flash');
  const [generationMode, setGenerationMode] = useState('manual'); // 'manual' | 'smart_auto'
  const [allowPaidProviders, setAllowPaidProviders] = useState(true);
  const [allowFallback, setAllowFallback] = useState(true);
  const [fallbackAlerts, setFallbackAlerts] = useState([]);
  const [activeProviderUsed, setActiveProviderUsed] = useState('');
  const [activeModelUsed, setActiveModelUsed] = useState('');

  // Provider mappings for display
  const PROVIDERS = {
    gemini: { name: 'Google Gemini' },
    openai: { name: 'OpenAI' },
    groq: { name: 'Groq' }
  };

  useEffect(() => {
    const loadModels = async () => {
      try {
        const data = await fetchAvailableModels();
        setModels(data);
        
        // Match selection models for selected provider
        const providerModels = data.filter(m => m.provider === selectedProvider);
        const recommended = providerModels.find(m => m.recommended && m.isAvailable);
        if (recommended) {
          setSelectedModelId(recommended.id);
        } else {
          const firstAvailable = providerModels.find(m => m.isAvailable);
          if (firstAvailable) {
            setSelectedModelId(firstAvailable.id);
          }
        }
      } catch (err) {
        console.error('Error loading available models:', err);
      }
    };
    loadModels();
  }, [selectedProvider, hasKeysToken]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mock') === 'true') {
      fetch('/dummy.pdf')
        .then(res => res.blob())
        .then(blob => {
          const mockFile = new File([blob], 'dummy_syllabus.pdf', { type: 'application/pdf' });
          setFile(mockFile);
          setSubjectName('Mock Graph Theory & Data Structures');
          
          // Convert mock file to base64 and set parsedResult so downstream note generation calls succeed
          const reader = new FileReader();
          reader.readAsDataURL(mockFile);
          reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            setParsedResult({
              type: 'pdf',
              base64,
              name: 'dummy_syllabus.pdf'
            });
          };

          setOutline([
            {
              unit: "Graph Theory Fundamentals",
              topics: [
                { id: "1", name: "Eulerian Paths & Circuits", description: "Learn about Konigsberg bridge problem, Eulerian paths, circuits, and Fleury algorithm.", selected: true },
                { id: "2", name: "Hamiltonian Cycles & TSP", description: "Understand Hamiltonian cycles, Dirac's theorem, Ore's theorem, and Traveling Salesperson Problem.", selected: true }
              ]
            },
            {
              unit: "Linear Data Structures",
              topics: [
                { id: "3", name: "Singly & Doubly Linked Lists", description: "Master pointers, node insertion, deletion, and traversal algorithms.", selected: true },
                { id: "4", name: "Stack & Queue Implementations", description: "Design stack and queue ADTs using arrays and linked lists.", selected: true }
              ]
            }
          ]);
          setStep('outline');
        })
        .catch(err => console.error('Error fetching mock file:', err));
    }
  }, []);

  const handleSaveApiKey = (gKey, oKey, grKey) => {
    localStorage.setItem('gemini_api_key', gKey.trim());
    localStorage.setItem('openai_api_key', oKey.trim());
    localStorage.setItem('groq_api_key', grKey.trim());
    setHasKeysToken(Math.random());
    setShowApiKeyModal(false);
  };

  const getSmartAutoModel = (fileLength, providerList) => {
    const geminiAvail = providerList.filter(m => m.provider === 'gemini' && m.isAvailable);
    const openaiAvail = providerList.filter(m => m.provider === 'openai' && m.isAvailable);
    const groqAvail = providerList.filter(m => m.provider === 'groq' && m.isAvailable);

    if (geminiAvail.length > 0) {
      const rec = geminiAvail.find(m => m.recommended) || geminiAvail[0];
      return { provider: 'gemini', model: rec.id };
    }

    if (allowPaidProviders && openaiAvail.length > 0) {
      const rec = openaiAvail.find(m => m.recommended) || openaiAvail[0];
      return { provider: 'openai', model: rec.id };
    }

    if (groqAvail.length > 0) {
      const rec = groqAvail.find(m => m.recommended) || groqAvail[0];
      return { provider: 'groq', model: rec.id };
    }

    return { provider: 'gemini', model: 'gemini-3.6-flash' };
  };

  // Flow State
  const [step, setStep] = useState('upload'); // 'upload' | 'processing' | 'outline' | 'preview'
  const [file, setFile] = useState(null);
  const [subjectName, setSubjectName] = useState('');
  const [error, setError] = useState(null);

  // Parsed / Generated Data
  const [parsedResult, setParsedResult] = useState(null);
  const [outline, setOutline] = useState([]); // [{ unit: string, topics: [{ id, name, description, selected }] }]
  const [notesData, setNotesData] = useState({}); // { topicName: notesJsonObject }
  const [masterSummary, setMasterSummary] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState(null); // String name of current preview topic
  
  // Generation Settings
  const [depth, setDepth] = useState('standard'); // 'concise' | 'standard' | 'detailed'

  // Processing States
  const [processingStatus, setProcessingStatus] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);

  // Apply dark mode theme
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);



  // 1. FILE UPLOAD & INITIAL PARSE
  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    setupFile(selectedFile);
  };

  const setupFile = (file) => {
    setFile(file);
    setError(null);
    // Remove extension for default subject name
    const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    setSubjectName(baseName);
  };

  const handleDragOver = (e) => e.preventDefault();
  
  const handleDrop = (e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.pdf') || droppedFile.name.endsWith('.pptx'))) {
      setupFile(droppedFile);
    } else {
      setError('Please upload a valid PDF or PPTX file.');
    }
  };

  const startProcessing = async () => {
    if (!file) {
      setError('Please select a file to parse.');
      return;
    }

    setStep('processing');
    setError(null);
    setProcessingProgress(10);
    setProcessingStatus('Extracting content from uploaded file...');

    try {
      // Step A: Parse file text content (Base64 for PDF, text pages for PPTX)
      const result = await parseFileContent(file);
      setParsedResult(result);

       setProcessingProgress(35);
      setProcessingStatus('Analyzing structure and extracting topics...');

      setFallbackAlerts([]);
      const response = await extractTopicOutline(result, selectedProvider, selectedModelId, allowFallback);
      const generatedOutline = response.data;
      if (response._meta?.fallbackTriggered) {
        setFallbackAlerts(prev => [...prev, ...response._meta.fallbackMessages]);
      }
      
      // Add a selection toggle state to each topic
      const outlineWithSelection = generatedOutline.map(unit => ({
        ...unit,
        topics: unit.topics.map(topic => ({ ...topic, selected: true }))
      }));

      setOutline(outlineWithSelection);
      setProcessingProgress(100);
      setStep('outline');
    } catch (err) {
      console.error(err);
      setError(err.message || 'An error occurred during file extraction.');
      setStep('upload');
    }
  };

  // 2. OUTLINE MANIPULATION HELPERS
  const toggleTopicSelection = (unitIndex, topicId) => {
    setOutline(prev => prev.map((unit, uIdx) => {
      if (uIdx !== unitIndex) return unit;
      return {
        ...unit,
        topics: unit.topics.map(t => t.id === topicId ? { ...t, selected: !t.selected } : t)
      };
    }));
  };

  const deleteTopic = (unitIndex, topicId) => {
    setOutline(prev => prev.map((unit, uIdx) => {
      if (uIdx !== unitIndex) return unit;
      return {
        ...unit,
        topics: unit.topics.filter(t => t.id !== topicId)
      };
    }).filter(unit => unit.topics.length > 0)); // Remove empty units
  };

  const renameTopic = (unitIndex, topicId, newName) => {
    if (!newName.trim()) return;
    setOutline(prev => prev.map((unit, uIdx) => {
      if (uIdx !== unitIndex) return unit;
      return {
        ...unit,
        topics: unit.topics.map(t => t.id === topicId ? { ...t, name: newName } : t)
      };
    }));
  };

  const addTopicToUnit = (unitIndex) => {
    const topicName = prompt('Enter new topic name:');
    if (!topicName) return;
    const desc = prompt('Enter a brief topic description:');

    setOutline(prev => prev.map((unit, uIdx) => {
      if (uIdx !== unitIndex) return unit;
      return {
        ...unit,
        topics: [
          ...unit.topics,
          {
            id: Date.now().toString(),
            name: topicName,
            description: desc || 'Custom topic added by user.',
            selected: true
          }
        ]
      };
    }));
  };

  const moveTopic = (unitIndex, topicIndex, direction) => {
    setOutline(prev => prev.map((unit, uIdx) => {
      if (uIdx !== unitIndex) return unit;
      const newTopics = [...unit.topics];
      const targetIndex = topicIndex + direction;
      if (targetIndex < 0 || targetIndex >= newTopics.length) return unit;
      // Swap
      const temp = newTopics[topicIndex];
      newTopics[topicIndex] = newTopics[targetIndex];
      newTopics[targetIndex] = temp;
      return { ...unit, topics: newTopics };
    }));
  };

  // 3. DETAILED NOTES GENERATION
  const startNotesGeneration = async () => {
    const selectedTopics = outline.flatMap(u => u.topics.filter(t => t.selected));
    if (selectedTopics.length === 0) {
      alert('Please select at least one topic to generate study notes.');
      return;
    }

    let activeProvider = selectedProvider;
    let activeModel = selectedModelId;

    if (generationMode === 'smart_auto') {
      const autoSelection = getSmartAutoModel(parsedResult?.base64?.length || 50000, models);
      activeProvider = autoSelection.provider;
      activeModel = autoSelection.model;
    }

    setActiveProviderUsed(PROVIDERS[activeProvider]?.name || activeProvider);
    setActiveModelUsed(activeModel);

    setFallbackAlerts([]);
    setStep('processing');
    setProcessingProgress(0);
    setNotesData({});
    setError(null);

    const totalSteps = selectedTopics.length + 1; // All topics + master summary
    let currentStepNum = 0;

    try {
      const generatedNotes = {};
      
      // Sequential notes generation for full depth and progress monitoring
      for (const topic of selectedTopics) {
        currentStepNum++;
        const pct = Math.floor((currentStepNum / totalSteps) * 100);
        setProcessingProgress(pct);
        setProcessingStatus(`Generating comprehensive notes for: "${topic.name}" using ${PROVIDERS[activeProvider]?.name} (${activeModel}) (${currentStepNum} of ${selectedTopics.length})...`);
        
        const response = await generateTopicNotes(topic.name, topic.description, parsedResult, depth, activeProvider, activeModel, allowFallback);
        const topicNotes = response.data;
        if (response._meta?.fallbackTriggered) {
          setFallbackAlerts(prev => {
            const newMsgs = response._meta.fallbackMessages.filter(msg => !prev.includes(msg));
            return [...prev, ...newMsgs];
          });
          setActiveProviderUsed(PROVIDERS[response._meta.providerUsed]?.name || response._meta.providerUsed);
          setActiveModelUsed(response._meta.modelUsed);
        }
        generatedNotes[topic.name] = topicNotes;
      }

      // Generate Master Summary Page
      setProcessingProgress(95);
      setProcessingStatus('Compiling master summary revision sheet...');
      const responseSummary = await generateMasterSummary(Object.values(generatedNotes), activeProvider, activeModel, allowFallback);
      const summaryRows = responseSummary.data;
      if (responseSummary._meta?.fallbackTriggered) {
        setFallbackAlerts(prev => {
          const newMsgs = responseSummary._meta.fallbackMessages.filter(msg => !prev.includes(msg));
          return [...prev, ...newMsgs];
        });
      }
      
      setNotesData(generatedNotes);
      setMasterSummary(summaryRows);
      setSelectedTopic(selectedTopics[0].name);
      setProcessingProgress(100);
      setStep('preview');
    } catch (err) {
      console.error(err);
      setError(err.message || 'An error occurred during notes generation.');
      setStep('outline');
    }
  };

  // 4. REGENERATE SINGLE SECTION
  const regenerateSingleTopic = async (topicName) => {
    const topicOutlineObj = outline.flatMap(u => u.topics).find(t => t.name === topicName);
    if (!topicOutlineObj) return;

    let activeProvider = selectedProvider;
    let activeModel = selectedModelId;

    if (generationMode === 'smart_auto') {
      const autoSelection = getSmartAutoModel(parsedResult?.base64?.length || 50000, models);
      activeProvider = autoSelection.provider;
      activeModel = autoSelection.model;
    }

    setProcessingStatus(`Regenerating notes for: "${topicName}" using ${PROVIDERS[activeProvider]?.name} (${activeModel})...`);
    setStep('processing');
    setProcessingProgress(50);

    try {
      const response = await generateTopicNotes(topicName, topicOutlineObj.description, parsedResult, depth, activeProvider, activeModel, allowFallback);
      const updatedNotes = response.data;
      if (response._meta?.fallbackTriggered) {
        setFallbackAlerts(prev => {
          const newMsgs = response._meta.fallbackMessages.filter(msg => !prev.includes(msg));
          return [...prev, ...newMsgs];
        });
      }
      setNotesData(prev => ({
        ...prev,
        [topicName]: updatedNotes
      }));
      setStep('preview');
    } catch (err) {
      console.error(err);
      alert(`Failed to regenerate notes: ${err.message}`);
      setStep('preview');
    }
  };

  // Render components based on current flow step
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 flex flex-col font-sans transition-colors duration-200">
      {/* HEADER NAVBAR */}
      <header className="sticky top-0 bg-white/80 dark:bg-[#0c0c0f]/80 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setStep('upload')}>
            <div className="bg-blue-600 text-white p-2 rounded-lg">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight m-0 text-zinc-950 dark:text-zinc-50 flex items-center gap-1.5">
                Notes Forge <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-semibold px-2 py-0.5 rounded-full">STEM Edition</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setGeminiKeyInput(localStorage.getItem('gemini_api_key') || '');
                setOpenaiKeyInput(localStorage.getItem('openai_api_key') || '');
                setGroqKeyInput(localStorage.getItem('groq_api_key') || '');
                setShowApiKeyModal(true);
              }}
              className="flex items-center gap-2 bg-[#ffffff] dark:bg-[#262626] hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-medium transition-all shadow-sm"
            >
              <Settings className="w-4 h-4" />
              <span>Local API Key Settings</span>
              {localStorage.getItem('gemini_api_key') || localStorage.getItem('openai_api_key') || localStorage.getItem('groq_api_key') ? (
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              )}
            </button>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-zinc-600 dark:text-zinc-300 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-6 py-8 flex flex-col justify-start">
        
        {/* UPLOAD SCREEN */}
        {step === 'upload' && (
          <div className="max-w-2xl mx-auto w-full flex flex-col gap-6 my-auto py-10">
            <div className="text-center">
              <h2 className="text-4xl font-extrabold tracking-tight mb-2">Forge raw course material into exam-ready notes</h2>
              <p className="text-zinc-500 dark:text-zinc-400 text-lg">
                Upload your engineering or CS lecture slides, textbooks, or notes, and let AI build a fully structured study guide.
              </p>
            </div>

            {error && (
              <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/40 text-rose-800 dark:text-rose-300 rounded-xl p-4 flex gap-3 items-center">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm font-medium">{error}</span>
              </div>
            )}

            <div 
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-4 transition-all bg-white dark:bg-[#0c0c0f] ${
                file ? 'border-blue-500 dark:border-blue-500 bg-blue-50/20 dark:bg-blue-900/10' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
              }`}
            >
              <div className="bg-zinc-100 dark:bg-zinc-800/80 p-4 rounded-full text-zinc-400 dark:text-zinc-500">
                <Upload className="w-10 h-10" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {file ? file.name : 'Drag & drop your files here'}
                </p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                  Supports PDF or PPTX slide decks (up to 50MB)
                </p>
              </div>

              <label className="bg-[#ffffff] dark:bg-[#262626] hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[#334155] dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 font-medium transition-colors shadow-sm cursor-pointer">
                Browse Files
                <input type="file" accept=".pdf,.pptx" onChange={handleFileChange} className="hidden" />
              </label>
            </div>

            {file && (
              <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 flex flex-col gap-4 shadow-sm">
                <div>
                  <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1.5">
                    Course / Subject Name
                  </label>
                  <input
                    type="text"
                    value={subjectName}
                    onChange={(e) => setSubjectName(e.target.value)}
                    placeholder="e.g. Data Structures and Algorithms"
                    className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-950 dark:text-zinc-100"
                  />
                </div>

                <button
                  onClick={startProcessing}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 font-semibold transition-colors shadow-md flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-5 h-5" />
                  <span>Analyze Course Material</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* PROCESSING & PROGRESS OVERLAY */}
        {step === 'processing' && (
          <div className="max-w-md mx-auto w-full flex flex-col gap-6 text-center my-auto py-12">
            <div className="relative w-24 h-24 mx-auto mb-4">
              {/* Outer pulsing ring */}
              <div className="absolute inset-0 rounded-full border-4 border-blue-500/20 dark:border-blue-500/10 animate-ping"></div>
              {/* Inner loading graphic */}
              <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
              <div className="absolute inset-2 bg-white dark:bg-[#09090b] rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400">
                <Sparkles className="w-8 h-8" />
              </div>
            </div>

            <div>
              <h3 className="text-2xl font-extrabold tracking-tight mb-2">Forging Study Notes...</h3>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm font-medium">{processingStatus}</p>
            </div>

            <div className="bg-zinc-200 dark:bg-zinc-800 h-2 w-full rounded-full overflow-hidden">
              <div 
                className="bg-blue-600 h-full transition-all duration-500 ease-out rounded-full" 
                style={{ width: `${processingProgress}%` }}
              ></div>
            </div>
            
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Generating premium notes requires multiple precise LLM steps to preserve deep academic depth. Please hold tight.
            </p>
          </div>
        )}

        {/* TOPIC CONFIRMATION SCREEN */}
        {step === 'outline' && (
          <div className="max-w-4xl mx-auto w-full flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Confirm Study Guide Outline</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Gemini has analyzed your material and built a structured syllabus. Review, delete, reorder, or add custom topics.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep('upload')}
                  className="flex items-center gap-2 bg-[#ffffff] dark:bg-[#262626] hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-sm font-medium transition-all shadow-sm"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Upload</span>
                </button>

                {(() => {
                  const selectedModelObj = models.find(m => m.id === selectedModelId);
                  const isModelUnavailable = selectedModelObj ? !selectedModelObj.isAvailable : false;
                  return (
                    <button
                      onClick={startNotesGeneration}
                      disabled={isModelUnavailable}
                      className={`rounded-lg px-5 py-2 text-sm font-semibold transition-colors shadow-md flex items-center gap-2 ${
                        isModelUnavailable
                          ? 'bg-zinc-300 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none'
                          : 'bg-blue-600 hover:bg-blue-700 text-white animate-pulse'
                      }`}
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>{isModelUnavailable ? 'Selected Model Unavailable' : 'Generate Detailed Notes'}</span>
                    </button>
                  );
                })()}
              </div>
            </div>

            {/* Depth and Model selector grid */}
            <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 p-6 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-6 shadow-sm">
              {/* Depth Controls */}
              <div className="flex flex-col gap-3 justify-center">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Notes Depth & Coverage:</label>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Detailed notes generate exhaustive explanations, code blocks, and SVG diagram blueprints.
                  </p>
                </div>
                <div className="inline-flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-1 w-fit">
                  {['concise', 'standard', 'detailed'].map(d => (
                    <button
                      key={d}
                      onClick={() => setDepth(d)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                        depth === d 
                          ? 'bg-blue-600 text-white shadow-sm' 
                          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI Provider & Mode Controls */}
              <div className="flex flex-col gap-3 border-t md:border-t-0 md:border-l md:border-r border-zinc-200 dark:border-zinc-800 pt-6 md:pt-0 md:px-6">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">AI Provider & Mode:</label>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setGenerationMode('manual')}
                    className={`rounded-lg py-1.5 text-xs font-semibold uppercase transition-all border ${
                      generationMode === 'manual'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-750 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    Manual
                  </button>
                  <button
                    onClick={() => setGenerationMode('smart_auto')}
                    className={`rounded-lg py-1.5 text-xs font-semibold uppercase transition-all border ${
                      generationMode === 'smart_auto'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-750 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    Smart Auto
                  </button>
                </div>

                {generationMode === 'manual' ? (
                  <div className="relative">
                    <select
                      value={selectedProvider}
                      onChange={(e) => setSelectedProvider(e.target.value)}
                      className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none text-zinc-950 dark:text-zinc-100 font-semibold cursor-pointer"
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="openai">OpenAI (Paid)</option>
                      <option value="groq">Groq</option>
                    </select>
                  </div>
                ) : (
                  <div className="bg-blue-500/10 border border-blue-500/20 p-2.5 rounded-lg text-xs text-blue-600 dark:text-blue-400">
                    Smart Mode chooses the best active model based on document complexity and provider availability.
                  </div>
                )}

                <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowPaidProviders}
                    onChange={(e) => setAllowPaidProviders(e.target.checked)}
                    className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500/50 cursor-pointer"
                  />
                  <span>Allow paid AI providers (OpenAI)</span>
                </label>
              </div>

              {/* Model selection */}
              <div className="flex flex-col gap-3 pt-6 md:pt-0">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">AI Model Selection:</label>
                </div>

                {generationMode === 'manual' ? (
                  <div className="relative">
                    <select
                      value={selectedModelId}
                      onChange={(e) => setSelectedModelId(e.target.value)}
                      className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none text-zinc-950 dark:text-zinc-100 font-semibold cursor-pointer"
                    >
                      {models.filter(m => m.provider === selectedProvider).map(m => (
                        <option key={m.id} value={m.id} disabled={!m.isAvailable}>
                          {m.displayName} {m.recommended ? '— (Rec)' : ''} {!m.isAvailable ? '— (Unavailable)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-750 p-2 rounded-lg text-xs font-mono font-semibold text-zinc-700 dark:text-zinc-300">
                    Auto-selected: {(() => {
                      const sel = getSmartAutoModel(parsedResult?.base64?.length || 50000, models);
                      return `${PROVIDERS[sel.provider]?.name || sel.provider} (${sel.model})`;
                    })()}
                  </div>
                )}

                {(() => {
                  let modelObj;
                  if (generationMode === 'manual') {
                    modelObj = models.find(m => m.id === selectedModelId && m.provider === selectedProvider);
                  } else {
                    const sel = getSmartAutoModel(parsedResult?.base64?.length || 50000, models);
                    modelObj = models.find(m => m.id === sel.model && m.provider === sel.provider);
                  }
                  if (!modelObj) return null;
                  return (
                    <div className="flex flex-col gap-1 bg-zinc-50 dark:bg-zinc-900/40 p-3 rounded-lg border border-zinc-200/40 dark:border-zinc-800/40">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-blue-600 dark:text-blue-400 font-bold">{modelObj.recommended ? 'Recommended Model' : 'Selected Model'}</span>
                        <div className="flex gap-2 text-zinc-500">
                          <span>Quality: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{modelObj.quality}</span></span>
                          <span>Speed: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{modelObj.speed}</span></span>
                        </div>
                      </div>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-1">{modelObj.description}</p>
                      <p className="text-[10px] text-zinc-450 dark:text-zinc-400 mt-0.5"><strong className="text-zinc-500">Best for:</strong> {modelObj.bestUseCase}</p>
                      <p className="text-[10px] text-zinc-450 dark:text-zinc-400 mt-0.5"><strong className="text-zinc-500">PDF Intake:</strong> {modelObj.pdfSupported ? 'Direct PDF Intake' : 'Text Extraction Extraction'}</p>
                    </div>
                  );
                })()}

                <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowFallback}
                    onChange={(e) => setAllowFallback(e.target.checked)}
                    className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500/50 cursor-pointer"
                  />
                  <span>Automatically switch provider/model if busy (recommended)</span>
                </label>
              </div>
            </div>

            {/* Outline list */}
            <div className="flex flex-col gap-6">
              {outline.map((unit, uIdx) => (
                <div key={uIdx} className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
                  {/* Unit Title Bar */}
                  <div className="bg-zinc-50 dark:bg-zinc-900/50 px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                    <h3 className="font-extrabold text-lg tracking-tight text-blue-600 dark:text-blue-400">
                      Unit {uIdx + 1}: {unit.unit}
                    </h3>
                    <button
                      onClick={() => addTopicToUnit(uIdx)}
                      className="text-xs text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 font-semibold flex items-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Topic</span>
                    </button>
                  </div>

                  {/* Topic Items list */}
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {unit.topics.map((topic, tIdx) => (
                      <div key={topic.id} className="p-4 flex items-start justify-between gap-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20 transition-colors">
                        <div className="flex items-start gap-3 flex-1">
                          <input
                            type="checkbox"
                            checked={topic.selected}
                            onChange={() => toggleTopicSelection(uIdx, topic.id)}
                            className="mt-1.5 w-4 h-4 text-blue-600 border-zinc-300 dark:border-zinc-700 rounded focus:ring-blue-500"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 group">
                              <span className="font-bold text-zinc-800 dark:text-zinc-100">{topic.name}</span>
                              <button 
                                onClick={() => {
                                  const name = prompt('Rename topic name:', topic.name);
                                  if (name) renameTopic(uIdx, topic.id, name);
                                }}
                                className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-opacity"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{topic.description}</p>
                          </div>
                        </div>

                        {/* Control buttons */}
                        <div className="flex items-center gap-1">
                          <button
                            disabled={tIdx === 0}
                            onClick={() => moveTopic(uIdx, tIdx, -1)}
                            className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded disabled:opacity-30 text-zinc-500"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button
                            disabled={tIdx === unit.topics.length - 1}
                            onClick={() => moveTopic(uIdx, tIdx, 1)}
                            className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded disabled:opacity-30 text-zinc-500"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteTopic(uIdx, topic.id)}
                            className="p-1 hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-500 rounded transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PREVIEW & DOWNLOAD SCREEN */}
        {step === 'preview' && (
          <>
            {/* Fallback alerts banner */}
            {fallbackAlerts.length > 0 && (
              <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex flex-col gap-2 text-amber-700 dark:text-amber-450 shadow-sm mb-6">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 animate-bounce" />
                  <span>Notice: Model Fallback Action Triggered During Generation</span>
                </div>
                <ul className="text-xs list-disc pl-5 flex flex-col gap-1 font-semibold">
                  {fallbackAlerts.map((msg, idx) => (
                    <li key={idx}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}
            
            <div className="flex-1 flex gap-6 flex-col md:flex-row items-stretch">
            
            {/* LEFT BAR: TOPICS & CONTROLS */}
            <div className="w-full md:w-80 flex flex-col gap-4 flex-shrink-0">
              
              {/* Primary Actions Card */}
              <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm flex flex-col gap-3">
                <button
                  onClick={() => downloadPdfGuide(subjectName, outline, notesData, masterSummary)}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 font-bold transition-colors shadow-md flex items-center justify-center gap-2"
                >
                  <FileDown className="w-5 h-5" />
                  <span>Download Premium PDF</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setStep('outline')}
                    className="bg-[#ffffff] dark:bg-[#262626] hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg py-2 text-xs font-semibold transition-all shadow-sm text-center"
                  >
                    Adjust Outline
                  </button>
                  <button
                    onClick={() => {
                      setFile(null);
                      setOutline([]);
                      setNotesData({});
                      setStep('upload');
                    }}
                    className="bg-[#ffffff] dark:bg-[#262626] hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg py-2 text-xs font-semibold transition-all shadow-sm text-center"
                  >
                    Upload New
                  </button>
                </div>
              </div>

              {/* Syllabus Outline list */}
              <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm flex-1 overflow-hidden flex flex-col">
                <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
                  <h4 className="text-xs font-extrabold text-zinc-500 uppercase tracking-wider">Syllabus Outline</h4>
                </div>

                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1 select-none">
                  {/* Master Summary trigger */}
                  <button
                    onClick={() => setSelectedTopic('__master_summary')}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                      selectedTopic === '__master_summary'
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900/40'
                    }`}
                  >
                    <BookOpen className="w-4 h-4 flex-shrink-0" />
                    <span>Master revision sheet</span>
                  </button>

                  <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-1"></div>

                  {outline.map((unit, uIdx) => (
                    <div key={uIdx} className="flex flex-col gap-0.5">
                      <div className="px-3 py-1 text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider mt-1">
                        Unit {uIdx + 1}
                      </div>

                      {unit.topics.filter(t => t.selected).map(topic => (
                        <button
                          key={topic.id}
                          onClick={() => setSelectedTopic(topic.name)}
                          className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            selectedTopic === topic.name
                              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-l-2 border-blue-600 pl-2.5'
                              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900/40'
                          }`}
                        >
                          {topic.name}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT AREA: DETAILED PREVIEW */}
            <div className="flex-1 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-y-auto max-h-[calc(100vh-140px)] flex flex-col">
              
              {/* If Master Summary is selected */}
              {selectedTopic === '__master_summary' ? (
                <div className="p-8 flex flex-col gap-6">
                  <div className="border-b border-zinc-200 dark:border-zinc-800 pb-4">
                    <h3 className="text-3xl font-extrabold tracking-tight">Master Revision Summary</h3>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                      Quick overview revision guide condensing all concepts, complexities, and exam tricks.
                    </p>
                  </div>

                  <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-sm divide-y divide-zinc-200 dark:divide-zinc-800">
                      <thead className="bg-zinc-50 dark:bg-zinc-900/60 font-semibold text-zinc-500 dark:text-zinc-400">
                        <tr>
                          <th className="px-4 py-3">Topic</th>
                          <th className="px-4 py-3">Core Takeaway</th>
                          <th className="px-4 py-3">Complexities / Metrics</th>
                          <th className="px-4 py-3">Exam Revision Tip</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {masterSummary.map((row, idx) => (
                          <tr key={idx} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20 transition-colors">
                            <td className="px-4 py-3 font-bold text-zinc-800 dark:text-zinc-200">{row.topic}</td>
                            <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{row.coreTakeaway}</td>
                            <td className="px-4 py-3 font-mono text-zinc-700 dark:text-zinc-300">{row.criticalMetric}</td>
                            <td className="px-4 py-3 text-amber-700 dark:text-amber-400 font-medium">{row.examTip}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                /* Topic Notes display */
                (() => {
                  const data = notesData[selectedTopic];
                  if (!data) return (
                    <div className="m-auto text-center py-10">
                      <AlertCircle className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
                      <p className="text-zinc-500">No notes data found for this topic.</p>
                    </div>
                  );

                  return (
                    <div className="p-8 flex flex-col gap-6">
                      
                      {/* Topic Title bar with single section regeneration */}
                      <div className="flex justify-between items-start border-b border-zinc-200 dark:border-zinc-800 pb-4">
                        <div>
                          <h3 className="text-3xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50">
                            {data.topicName}
                          </h3>
                          <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                            Study notes & exam reference sheets
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => {
                              setApiKeyInput(localStorage.getItem('gemini_api_key') || '');
                              setShowApiKeyModal(true);
                            }}
                            className="flex items-center gap-2 bg-[#ffffff] dark:bg-[#262626] hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-medium transition-all shadow-sm"
                          >
                            <Settings className="w-4 h-4" />
                            <span>Local API Key Settings</span>
                            {hasLocalKey ? (
                              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            ) : (
                              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                            )}
                          </button>
                          <button
                            onClick={() => regenerateSingleTopic(data.topicName)}
                            className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5"
                          >
                            <RotateCw className="w-3.5 h-3.5" />
                            <span>Regenerate Section</span>
                          </button>
                        </div>
                      </div>

                      {/* CALLOUT: DEFINITION */}
                      <div className="border-l-4 border-teal-600 bg-teal-500/10 dark:bg-teal-500/5 p-4 rounded-r-xl">
                        <span className="text-[10px] font-extrabold text-teal-600 dark:text-teal-400 uppercase tracking-widest block mb-1">
                          Definition
                        </span>
                        <p className="text-zinc-800 dark:text-zinc-200 leading-relaxed text-sm md:text-base">
                          {data.definition}
                        </p>
                      </div>

                      {/* CALLOUT: WHY IT MATTERS */}
                      <div className="border-l-4 border-blue-600 bg-blue-500/10 dark:bg-blue-500/5 p-4 rounded-r-xl">
                        <span className="text-[10px] font-extrabold text-blue-600 dark:text-blue-400 uppercase tracking-widest block mb-1">
                          Why It Matters
                        </span>
                        <p className="text-zinc-800 dark:text-zinc-200 leading-relaxed text-sm">
                          {data.whyItMatters}
                        </p>
                      </div>

                      {/* HOW IT WORKS */}
                      <div>
                        <h4 className="text-xs font-extrabold text-zinc-500 uppercase tracking-widest mb-3">
                          How It Works
                        </h4>
                        <ol className="flex flex-col gap-3">
                          {data.howItWorks.map((step, idx) => (
                            <li key={idx} className="flex gap-3 text-sm leading-relaxed">
                              <span className="font-extrabold text-blue-600 dark:text-blue-400 select-none">
                                {idx + 1}.
                              </span>
                              <span className="text-zinc-700 dark:text-zinc-300">{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>

                      {/* DIAGRAM SVG */}
                      {data.diagramSvg && (
                        <div>
                          <h4 className="text-xs font-extrabold text-zinc-500 uppercase tracking-widest mb-3">
                            Visual Structure
                          </h4>
                          <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl flex justify-center overflow-x-auto shadow-inner">
                            <div 
                              className="flex-shrink-0"
                              dangerouslySetInnerHTML={{ __html: cleanSvg(data.diagramSvg) }}
                            />
                          </div>
                        </div>
                      )}

                      {/* COMPLEXITY METRICS */}
                      {data.complexity && (data.complexity.time || data.complexity.space) && (
                        <div>
                          <h4 className="text-xs font-extrabold text-zinc-500 uppercase tracking-widest mb-3">
                            Complexity & Quantitative Metrics
                          </h4>
                          <div className="border-l-4 border-purple-600 bg-purple-500/10 dark:bg-purple-500/5 p-4 rounded-r-xl flex flex-col gap-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 block mb-0.5">Time Complexity</span>
                                <span className="font-mono font-bold text-sm text-zinc-800 dark:text-zinc-200">{data.complexity.time || 'N/A'}</span>
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 block mb-0.5">Space Complexity</span>
                                <span className="font-mono font-bold text-sm text-zinc-800 dark:text-zinc-200">{data.complexity.space || 'N/A'}</span>
                              </div>
                            </div>
                            <div className="h-px bg-purple-200 dark:bg-purple-900/30"></div>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                              {data.complexity.explanation}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* CODE / EXAMPLE BLOCK */}
                      {data.codeSnippet && data.codeSnippet.code && (
                        <div>
                          <h4 className="text-xs font-extrabold text-zinc-500 uppercase tracking-widest mb-3">
                            {data.codeSnippet.language === 'none' ? 'Worked Example & Walkthrough' : 'Implementation Blueprint'}
                          </h4>
                          <div className="bg-[#18181b] border border-zinc-800 rounded-xl overflow-hidden flex flex-col shadow-lg">
                            <div className="bg-zinc-900 px-4 py-2 border-b border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
                              <span className="font-mono uppercase">{data.codeSnippet.language === 'none' ? 'worked example' : data.codeSnippet.language}</span>
                              <FileCode className="w-4 h-4" />
                            </div>
                            <pre className="p-4 overflow-x-auto text-emerald-400 dark:text-emerald-300 font-mono text-xs md:text-sm leading-relaxed whitespace-pre">
                              <code>{data.codeSnippet.code}</code>
                            </pre>
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2.5 leading-relaxed bg-zinc-50 dark:bg-zinc-900/40 p-3 rounded-lg border border-zinc-200/50 dark:border-zinc-800/40">
                            {data.codeSnippet.explanation}
                          </p>
                        </div>
                      )}

                      {/* COMPARISON TABLES */}
                      {data.comparisons && data.comparisons.length > 0 && (
                        <div>
                          <h4 className="text-xs font-extrabold text-zinc-500 uppercase tracking-widest mb-3">
                            Comparative Analysis
                          </h4>
                          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                            <table className="w-full text-left text-xs md:text-sm divide-y divide-zinc-200 dark:divide-zinc-800">
                              <thead className="bg-blue-600 text-white font-bold">
                                <tr>
                                  <th className="px-4 py-2.5">Feature</th>
                                  <th className="px-4 py-2.5">{data.topicName}</th>
                                  <th className="px-4 py-2.5">Related Implementation</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-zinc-700 dark:text-zinc-300">
                                {data.comparisons.map((c, idx) => (
                                  <tr key={idx} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20 transition-colors">
                                    <td className="px-4 py-2.5 font-bold">{c.feature}</td>
                                    <td className="px-4 py-2.5">{c.conceptA}</td>
                                    <td className="px-4 py-2.5">{c.conceptB}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* EXAM FOCUS / TIPS */}
                      {data.examFocus && data.examFocus.length > 0 && (
                        <div className="border-l-4 border-amber-600 bg-amber-500/10 dark:bg-amber-500/5 p-4 rounded-r-xl">
                          <span className="text-[10px] font-extrabold text-amber-600 dark:text-amber-400 uppercase tracking-widest block mb-2">
                            Exam Focus & Tips
                          </span>
                          <ul className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                            {data.examFocus.map((tip, idx) => (
                              <li key={idx} className="flex gap-2">
                                <span className="text-amber-600 dark:text-amber-400 select-none">•</span>
                                <span>{tip}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                    </div>
                  );
                })()
              )}

            </div>
          </div>
        </>
      )}

      </main>

      {/* FOOTER */}
      <footer className="py-6 border-t border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-400 dark:text-zinc-600 mt-8">
      </footer>
      {/* API KEY SETTINGS MODAL */}
      {showApiKeyModal && (
        <div className="fixed inset-0 bg-zinc-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0c0c0f] rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-lg text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-600" />
                <span>Local API Keys Override</span>
              </h3>
              <button 
                onClick={() => setShowApiKeyModal(false)}
                className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-850 rounded-lg text-zinc-400 hover:text-zinc-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                (Optional) Enter your API keys here to test locally. Keys are saved in local storage and sent securely as headers to the backend server.
              </p>
              
              <div>
                <label className="text-xs font-semibold text-zinc-500 block mb-1">Local Gemini API Key</label>
                <input
                  type="password"
                  value={geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-950 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-500 block mb-1">Local OpenAI API Key</label>
                <input
                  type="password"
                  value={openaiKeyInput}
                  onChange={(e) => setOpenaiKeyInput(e.target.value)}
                  placeholder="sk-proj-..."
                  className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-950 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-500 block mb-1">Local Groq API Key</label>
                <input
                  type="password"
                  value={groqKeyInput}
                  onChange={(e) => setGroqKeyInput(e.target.value)}
                  placeholder="gsk_..."
                  className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-950 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => {
                  setGeminiKeyInput('');
                  setOpenaiKeyInput('');
                  setGroqKeyInput('');
                  handleSaveApiKey('', '', '');
                }}
                className="bg-[#ffffff] dark:bg-[#262626] hover:bg-zinc-100 dark:hover:bg-zinc-850 text-rose-600 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-xs font-semibold shadow-sm"
              >
                Clear All
              </button>
              <button
                onClick={() => handleSaveApiKey(geminiKeyInput, openaiKeyInput, groqKeyInput)}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors shadow-sm"
              >
                Save Keys
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
