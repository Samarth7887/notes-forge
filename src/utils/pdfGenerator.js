import pdfMake from 'pdfmake/build/pdfmake.js';
import pdfFonts from 'pdfmake/build/vfs_fonts.js';

// Initialize the virtual file system with bundled Roboto font robustly
try {
  if (pdfFonts && pdfFonts.pdfMake && pdfFonts.pdfMake.vfs) {
    pdfMake.vfs = pdfFonts.pdfMake.vfs;
  } else if (pdfFonts && pdfFonts.vfs) {
    pdfMake.vfs = pdfFonts.vfs;
  } else {
    pdfMake.vfs = pdfFonts;
  }
} catch (e) {
  console.error("Failed to load pdfMake virtual fonts filesystem:", e);
}

// ============================================================================
// COLOR SYSTEM — Consistent academic color palette
// ============================================================================
const COLORS = {
  // Accent colors for callout types
  definition: '#0d9488',     // Teal
  definitionBg: '#f0fdfa',
  note: '#3b82f6',           // Blue
  noteBg: '#eff6ff',
  example: '#2563eb',        // Deeper Blue
  exampleBg: '#eff6ff',
  memoryTrick: '#6d28d9',    // Purple
  memoryTrickBg: '#faf5ff',
  examTip: '#d97706',        // Amber
  examTipBg: '#fef3c7',
  commonMistake: '#dc2626',  // Red
  commonMistakeBg: '#fef2f2',
  important: '#be185d',      // Pink
  importantBg: '#fdf2f8',
  quickRecall: '#0891b2',    // Cyan
  quickRecallBg: '#ecfeff',
  warning: '#ea580c',        // Orange
  warningBg: '#fff7ed',
  caseStudy: '#b45309',      // Dark Amber
  caseStudyBg: '#fef3c7',
  // Structural colors
  primary: '#3b82f6',
  headerDark: '#18181b',
  textBody: '#27272a',
  textMuted: '#71717a',
  textLight: '#a1a1aa',
  border: '#e4e4e7',
  tableFill: '#f4f4f5',
  codeBg: '#18181b',
  codeText: '#f4f4f5',
  white: '#ffffff',
  coverAccent: '#3b82f6',
};

// ============================================================================
// REUSABLE COMPONENTS
// ============================================================================

/**
 * Creates a colored callout box with a thick left border.
 */
const createCallout = (title, bodyContent, accentColor, bgColor) => {
  return {
    table: {
      widths: [4, '*'],
      body: [
        [
          { text: '', fillColor: accentColor },
          {
            stack: [
              { text: title.toUpperCase(), style: 'calloutTitle', color: accentColor },
              typeof bodyContent === 'string'
                ? { text: bodyContent, style: 'calloutText' }
                : bodyContent
            ],
            fillColor: bgColor,
            margin: [12, 10, 12, 10]
          }
        ]
      ]
    },
    layout: 'noBorders',
    margin: [0, 6, 0, 10]
  };
};

/**
 * Clean and validate SVG strings to prevent pdfmake XML SAX parser errors.
 */
const cleanSvg = (svgString) => {
  if (!svgString || typeof svgString !== 'string') return '';

  // Extract <svg ... </svg> content
  const match = svgString.match(/<svg[\s\S]*?<\/svg>/i);
  if (!match) return '';
  let svg = match[0];

  // 1. Ensure xmlns attribute is present
  if (!svg.includes('xmlns=')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // 2. Auto-fix self-closing tags that lack a trailing slash (e.g., <rect ...> without />)
  svg = svg.replace(/<((?:rect|circle|ellipse|line|polyline|polygon|path|stop|use|image)\b[^>]*?)(?<!\/)>/gi, '<$1 />');

  // 3. Remove script tags and inline event handlers for safety
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
  svg = svg.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');

  // 4. In Browser environment, use DOMParser & XMLSerializer to validate & normalize XML
  if (typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined') {
    try {
      const parser = new window.DOMParser();
      const doc = parser.parseFromString(svg, 'image/svg+xml');
      const parserError = doc.querySelector('parsererror');

      if (parserError) {
        // Attempt repair: remove orphaned closing tags (like </rect>, </circle>, </path> when self-closed)
        const repairedSvg = svg.replace(/<\/(?:rect|circle|ellipse|line|polyline|polygon|path|stop|use|image)>/gi, '');
        const repairDoc = parser.parseFromString(repairedSvg, 'image/svg+xml');
        
        if (repairDoc.querySelector('parsererror')) {
          console.warn('SVG repair failed, omitting invalid SVG to prevent PDF generation crash.');
          return ''; // Omit invalid SVG to protect PDF rendering pipeline
        }

        const serializer = new window.XMLSerializer();
        return serializer.serializeToString(repairDoc);
      }

      const serializer = new window.XMLSerializer();
      return serializer.serializeToString(doc);
    } catch (e) {
      console.warn('DOMParser SVG validation failed:', e);
    }
  }

  return svg;
};

// --- Individual Callout Type Builders ---

const createDefinitionBox = (title, text) => {
  return createCallout(title || 'Source Definition', text, COLORS.definition, COLORS.definitionBg);
};

const createNoteBox = (content) => {
  return createCallout('In Very Easy Words', content, COLORS.note, COLORS.noteBg);
};

const createExampleBox = (ex) => {
  return createCallout(ex.title || 'Example', typeof ex === 'string' ? ex : (ex.explanation || ex), COLORS.example, COLORS.exampleBg);
};

export const createImportantBox = (content) => {
  return createCallout('Important', content, COLORS.important, COLORS.importantBg);
};

const createQuickRecallBox = (questions) => {
  if (!questions || questions.length === 0) return null;
  const items = questions.map(q => ({ text: `❓ ${q}`, margin: [0, 2, 0, 2], fontSize: 9.5, color: COLORS.textBody }));
  return createCallout('Quick Recall — Test Yourself', { stack: items }, COLORS.quickRecall, COLORS.quickRecallBg);
};

export const createWarningBox = (content) => {
  return createCallout('Warning', content, COLORS.warning, COLORS.warningBg);
};

const createMemoryTrickBox = (tricks) => {
  if (!tricks || tricks.length === 0) return null;
  const items = tricks.map(t => {
    return {
      text: [
        { text: `"${t.mnemonic}"`, bold: true, color: COLORS.memoryTrick },
        ` — ${t.meaning}\n`,
        { text: t.explanation, fontSize: 9.5, color: '#4b5563' }
      ],
      margin: [0, 4, 0, 4]
    };
  });
  return createCallout('Memory Trick / Mnemonic', { stack: items }, COLORS.memoryTrick, COLORS.memoryTrickBg);
};

const createExamTipBox = (tips) => {
  if (!tips || tips.length === 0) return null;
  const items = tips.map(tip => ({ text: `💡 ${tip}`, margin: [0, 2, 0, 2] }));
  return createCallout('Exam Tip', { stack: items }, COLORS.examTip, COLORS.examTipBg);
};

const createCommonMistakeBox = (mistakes) => {
  if (!mistakes || mistakes.length === 0) return null;
  const items = mistakes.map(m => ({ text: `✗ ${m}`, margin: [0, 2, 0, 2] }));
  return createCallout('Common Mistake', { stack: items }, COLORS.commonMistake, COLORS.commonMistakeBg);
};

// --- Structural Component Builders ---

const createCoverPage = (courseInfo, syllabusLines, generatedDate) => {
  const title = (courseInfo.subjectName || 'Study Guide').toUpperCase();
  const courseCode = courseInfo.courseCode ? `${courseInfo.courseCode} — ` : '';
  const moduleInfo = courseInfo.moduleTitle
    ? `${courseInfo.moduleNumber || 'Module'}: ${courseInfo.moduleTitle}`
    : '';

  return [
    { text: '\n\n\n', style: 'spacer' },
    courseCode ? { text: courseCode.toUpperCase(), fontSize: 14, bold: true, color: COLORS.textMuted, letterSpacing: 2, margin: [0, 0, 0, 4] } : null,
    { text: title, style: 'coverTitle' },
    moduleInfo ? { text: moduleInfo, fontSize: 16, bold: true, color: COLORS.coverAccent, margin: [0, 8, 0, 4] } : null,
    { text: 'COMPLETE EXAM GUIDE', fontSize: 13, bold: true, color: COLORS.textMuted, letterSpacing: 2, margin: [0, 4, 0, 12] },
    {
      canvas: [
        { type: 'line', x1: 0, y1: 0, x2: 450, y2: 0, lineWidth: 3, lineColor: COLORS.coverAccent }
      ],
      margin: [0, 10, 0, 20]
    },
    { text: 'Beginner-friendly · Teach-from-scratch · Exam-oriented', style: 'coverSubtitle', fontSize: 11, color: COLORS.textMuted, margin: [0, 0, 0, 20] },
    createCallout('About This Guide', {
      stack: [
        { text: '✓ Source-grounded: All facts, definitions, numbers, and examples come strictly from the uploaded course material.', margin: [0, 2, 0, 2], fontSize: 9.5 },
        { text: '✓ Beginner-friendly: Every concept is explained in simple words with everyday analogies.', margin: [0, 2, 0, 2], fontSize: 9.5 },
        { text: '✓ Exam-oriented: Includes priority ratings, memory tricks, exam tips, model answers, and revision checklists.', margin: [0, 2, 0, 2], fontSize: 9.5 },
        { text: '✓ University standard: Structured like a professional exam handbook with proper chapters and sections.', margin: [0, 2, 0, 2], fontSize: 9.5 }
      ]
    }, COLORS.primary, '#f0f7ff'),
    syllabusLines && syllabusLines !== 'Official syllabus lines were not present in the uploaded presentation.'
      ? {
          stack: [
            { text: 'OFFICIAL SYLLABUS LINES', style: 'subSectionTitle', bold: true, fontSize: 11 },
            { text: syllabusLines, style: 'calloutText', margin: [0, 4, 0, 16] }
          ]
        }
      : null,
    { text: `Generated on ${generatedDate}`, style: 'coverMeta' },
    { text: 'Built from the uploaded course material · Notes Forge', style: 'coverMetaMuted' },
    { text: '', pageBreak: 'after' }
  ].filter(Boolean);
};

const createCourseInfoSection = (outcomes, assessment, references) => {
  const blocks = [];
  if ((outcomes && outcomes.length > 0) || (assessment && assessment.length > 0) || (references && references.length > 0)) {
    blocks.push(
      { text: 'COURSE INSTRUCTIONAL DETAILS', style: 'unitTitle', tocItem: true, pageBreak: 'before', keepWithNext: true },
      {
        canvas: [
          { type: 'line', x1: 0, y1: 0, x2: 450, y2: 0, lineWidth: 1.5, lineColor: COLORS.border }
        ],
        margin: [0, 8, 0, 16]
      }
    );

    if (outcomes && outcomes.length > 0) {
      blocks.push(
        { text: 'COURSE OUTCOMES', style: 'subSectionTitle', bold: true, keepWithNext: true },
        {
          ul: outcomes.map(o => ({ text: o, style: 'calloutText' })),
          margin: [10, 4, 0, 14]
        }
      );
    }

    if (assessment && assessment.length > 0) {
      blocks.push(
        { text: 'ASSESSMENT SCHEME & PATTERN', style: 'subSectionTitle', bold: true, keepWithNext: true },
        {
          ul: assessment.map(a => ({ text: a, style: 'calloutText' })),
          margin: [10, 4, 0, 14]
        }
      );
    }

    if (references && references.length > 0) {
      blocks.push(
        { text: 'RECOMMENDED REFERENCES / BOOKS', style: 'subSectionTitle', bold: true, keepWithNext: true },
        {
          ul: references.map(r => ({ text: r, style: 'calloutText' })),
          margin: [10, 4, 0, 14]
        }
      );
    }
  }
  return blocks;
};

const createChapterHeader = (title, subtitle) => {
  return [
    { text: title.toUpperCase(), style: 'unitTitle', tocItem: true, pageBreak: 'before', keepWithNext: true },
    subtitle ? { text: subtitle, style: 'subtitle', margin: [0, 4, 0, 8], keepWithNext: true } : null,
    {
      canvas: [
        { type: 'line', x1: 0, y1: 0, x2: 450, y2: 0, lineWidth: 1.5, lineColor: COLORS.border }
      ],
      margin: [0, 6, 0, 16],
      keepWithNext: true
    }
  ].filter(Boolean);
};

const createTopicHeader = (name, location, priority) => {
  const prioLevel = priority?.level || priority || 'MEDIUM';
  const prioColorMap = {
    'VERY HIGH': '#dc2626',
    'HIGH': '#d97706',
    'MEDIUM': '#2563eb',
    'LOW': '#71717a'
  };
  const prioColor = prioColorMap[prioLevel] || COLORS.primary;

  return [
    {
      columns: [
        { text: name, style: 'topicTitle', tocItem: true, tocMargin: [15, 0, 0, 0], width: '*' },
        { text: `[${prioLevel}]`, color: prioColor, bold: true, fontSize: 10, alignment: 'right', width: 'auto' }
      ],
      margin: [0, 18, 0, 4],
      keepWithNext: true
    },
    location ? { text: `Source: ${location}`, style: 'coverMetaMuted', italics: true, margin: [0, 0, 0, 4], keepWithNext: true } : null,
    priority?.reason ? { text: `Priority: ${priority.reason}`, fontSize: 8.5, color: COLORS.textLight, italics: true, margin: [0, 0, 0, 10], keepWithNext: true } : null
  ].filter(Boolean);
};

const createTable = (headers, rows, widths = null) => {
  if (!headers || headers.length === 0) return null;
  const tableWidths = widths || headers.map(() => '*');

  const headRow = headers.map(h => ({ text: h, style: 'tableHeader' }));
  const bodyRows = (rows || []).map((r, rIdx) => r.map(cell => ({
    text: cell || '',
    style: 'tableCell',
    fillColor: rIdx % 2 === 0 ? COLORS.tableFill : null
  })));

  return {
    table: {
      headerRows: 1,
      widths: tableWidths,
      dontBreakRows: true,
      body: [headRow, ...bodyRows]
    },
    layout: {
      fillColor: (rowIndex) => rowIndex === 0 ? COLORS.headerDark : null,
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => COLORS.border,
      vLineColor: () => COLORS.border,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 5,
      paddingBottom: () => 5
    },
    margin: [0, 6, 0, 14]
  };
};

const createDiagram = (title, caption, svg, steps) => {
  const elements = [
    { text: (title || 'VISUAL STRUCTURE').toUpperCase(), style: 'subSectionTitle', keepWithNext: true }
  ];

  const svgCleaned = cleanSvg(svg);
  if (svgCleaned) {
    elements.push({
      svg: svgCleaned,
      width: 320,
      alignment: 'center',
      margin: [0, 8, 0, 10]
    });
  }

  if (caption) {
    elements.push({
      text: caption,
      style: 'coverMetaMuted',
      alignment: 'center',
      italics: true,
      margin: [0, 0, 0, 10]
    });
  }

  if (steps && steps.length > 0) {
    elements.push(
      createCallout('How to Draw This in the Exam', {
        stack: [
          {
            ol: steps.map(s => ({ text: s, style: 'calloutText', fontSize: 9.5 })),
            margin: [6, 0, 0, 0]
          }
        ]
      }, '#4b5563', '#f9fafb')
    );
  }

  return {
    stack: elements,
    margin: [0, 6, 0, 12]
  };
};

const createCodeBlock = (lang, code, explanation) => {
  return {
    stack: [
      { text: `CODE EXAMPLE (${(lang || 'code').toUpperCase()})`, style: 'subSectionTitle', keepWithNext: true },
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: [
                  { text: `// Language: ${lang || 'code'}`, fontSize: 7.5, color: COLORS.textLight, margin: [0, 0, 0, 4] },
                  { text: code, style: 'codeBody' }
                ],
                fillColor: COLORS.codeBg,
                margin: [12, 10, 12, 10]
              }
            ]
          ]
        },
        layout: 'noBorders',
        margin: [0, 4, 0, 6]
      },
      explanation ? { text: explanation, style: 'codeExplanation', margin: [4, 0, 4, 12] } : null
    ].filter(Boolean),
    margin: [0, 6, 0, 12]
  };
};

const createCaseStudy = (cs) => {
  if (!cs || !cs.title) return null;
  const fields = [
    cs.problem ? [{ text: 'PROBLEM / CHALLENGE:', bold: true, color: COLORS.caseStudy }, { text: cs.problem, margin: [0, 2, 0, 6] }] : null,
    cs.objective ? [{ text: 'OBJECTIVE:', bold: true, color: COLORS.caseStudy }, { text: cs.objective, margin: [0, 2, 0, 6] }] : null,
    cs.dataSource ? [{ text: 'DATA / SOURCE:', bold: true, color: COLORS.caseStudy }, { text: cs.dataSource, margin: [0, 2, 0, 6] }] : null,
    cs.method ? [{ text: 'METHOD & PROCESS:', bold: true, color: COLORS.caseStudy }, { text: cs.method, margin: [0, 2, 0, 6] }] : null,
    cs.analysis ? [{ text: 'ANALYSIS:', bold: true, color: COLORS.caseStudy }, { text: cs.analysis, margin: [0, 2, 0, 6] }] : null,
    cs.result ? [{ text: 'RESULT:', bold: true, color: COLORS.caseStudy }, { text: cs.result, margin: [0, 2, 0, 6] }] : null,
    cs.importantNumbers ? [{ text: 'KEY NUMBERS:', bold: true, color: COLORS.caseStudy }, { text: cs.importantNumbers, margin: [0, 2, 0, 6] }] : null,
    cs.examRelevance ? [{ text: 'EXAM RELEVANCE:', bold: true, color: COLORS.caseStudy }, { text: cs.examRelevance, margin: [0, 2, 0, 6] }] : null,
    cs.howToReproduce ? [{ text: 'HOW TO REPRODUCE IN EXAM:', bold: true, color: COLORS.caseStudy }, { text: cs.howToReproduce, margin: [0, 2, 0, 2] }] : null
  ].filter(Boolean).flat();

  return createCallout(`Case Study: ${cs.title}`, { stack: fields }, COLORS.caseStudy, COLORS.caseStudyBg);
};

const createWorkedExample = (we) => {
  if (!we || !we.formula) return null;
  const fields = [
    { text: 'GIVEN:', bold: true, color: COLORS.commonMistake },
    { text: we.given, margin: [0, 2, 0, 6] },
    { text: 'REQUIRED:', bold: true, color: COLORS.commonMistake },
    { text: we.required, margin: [0, 2, 0, 6] },
    { text: 'FORMULA:', bold: true, color: COLORS.commonMistake },
    { text: we.formula, margin: [0, 2, 0, 6] },
    { text: 'SUBSTITUTION:', bold: true, color: COLORS.commonMistake },
    { text: we.substitution, margin: [0, 2, 0, 6] },
    { text: 'CALCULATION:', bold: true, color: COLORS.commonMistake },
    { text: we.calculation, margin: [0, 2, 0, 6] },
    { text: 'ANSWER:', bold: true, color: COLORS.commonMistake },
    { text: we.answer, margin: [0, 2, 0, 6] },
    we.interpretation ? { text: 'INTERPRETATION:', bold: true, color: COLORS.commonMistake } : null,
    we.interpretation ? { text: we.interpretation, margin: [0, 2, 0, 2] } : null
  ].filter(Boolean);
  return createCallout(we.title || 'Worked Example', { stack: fields }, COLORS.commonMistake, COLORS.commonMistakeBg);
};

const createQuestion = (tut, idx) => {
  return {
    stack: [
      { text: `Q${idx + 1}. ${tut.question}`, bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      tut.solution ? { text: `Solution: ${tut.solution}`, margin: [0, 2, 0, 4], color: '#16a34a', fontSize: 9.5 } : null,
      tut.explanation ? { text: `Explanation: ${tut.explanation}`, margin: [0, 2, 0, 4], color: '#4b5563', fontSize: 9.5 } : null,
      tut.marks ? { text: `[${tut.marks} marks]`, fontSize: 8.5, color: COLORS.textMuted, italics: true, margin: [0, 0, 0, 8] } : null
    ].filter(Boolean),
    margin: [0, 4, 0, 8]
  };
};

const createExamQuestionSection = (examQuestions) => {
  if (!examQuestions) return [];
  const elements = [];

  if (examQuestions.twoMark && examQuestions.twoMark.length > 0) {
    elements.push({ text: '2-MARK QUESTIONS', style: 'subSectionTitle', color: COLORS.primary, keepWithNext: true, margin: [0, 8, 0, 4] });
    examQuestions.twoMark.forEach((q, idx) => {
      elements.push(
        { text: `Q${idx + 1}. ${q.question}`, bold: true, fontSize: 10, margin: [0, 4, 0, 2] },
        createCallout('Model Answer (2 Marks)', q.modelAnswer || '', '#16a34a', '#f0fdf4')
      );
    });
  }

  if (examQuestions.fiveMark && examQuestions.fiveMark.length > 0) {
    elements.push({ text: '5-MARK QUESTIONS', style: 'subSectionTitle', color: COLORS.primary, keepWithNext: true, margin: [0, 12, 0, 4] });
    examQuestions.fiveMark.forEach((q, idx) => {
      elements.push(
        { text: `Q${idx + 1}. ${q.question}`, bold: true, fontSize: 10, margin: [0, 4, 0, 2] },
        createCallout('Model Answer (5 Marks)', q.modelAnswer || '', '#16a34a', '#f0fdf4')
      );
    });
  }

  if (examQuestions.tenMark && examQuestions.tenMark.length > 0) {
    elements.push({ text: '10-MARK QUESTIONS', style: 'subSectionTitle', color: COLORS.primary, keepWithNext: true, margin: [0, 12, 0, 4] });
    examQuestions.tenMark.forEach((q, idx) => {
      elements.push(
        { text: `Q${idx + 1}. ${q.question}`, bold: true, fontSize: 10, margin: [0, 4, 0, 2] },
        q.answerStructure ? createCallout('Answer Structure', q.answerStructure, '#6d28d9', '#faf5ff') : null,
        createCallout('Model Answer (10 Marks)', q.modelAnswer || '', '#16a34a', '#f0fdf4')
      );
    });
  }

  return elements.filter(Boolean);
};

const createAnswerTemplate = (templates) => {
  return [
    { text: '2-MARK ANSWER TEMPLATE', style: 'subSectionTitle', color: COLORS.primary, keepWithNext: true },
    createCallout('2-Mark Blueprint', templates.twoMark || 'Definition + 1 supportive point / key formula.', COLORS.primary, COLORS.noteBg),
    { text: '5-MARK ANSWER TEMPLATE', style: 'subSectionTitle', color: COLORS.primary, keepWithNext: true },
    createCallout('5-Mark Blueprint', templates.fiveMark || 'Introduction, core mechanism steps, diagram representation, and example.', COLORS.primary, COLORS.noteBg),
    { text: '10-MARK ANSWER TEMPLATE', style: 'subSectionTitle', color: COLORS.primary, keepWithNext: true },
    createCallout('10-Mark Blueprint', templates.tenMark || 'Detailed Essay: Intro/Definition, visual diagram, step-by-step working principles, comparative analysis table, worked numerical / case study, and critical interpretation conclusion.', COLORS.primary, COLORS.noteBg)
  ];
};

const createRevisionChecklist = (checklist) => {
  if (!checklist || checklist.length === 0) return null;
  return {
    ul: checklist.map(item => ({ text: `☐  ${item}`, style: 'calloutText' })),
    margin: [10, 6, 0, 16]
  };
};

const createHeader = (courseInfo) => {
  return (currentPage) => {
    if (currentPage === 1) return null;
    return {
      columns: [
        { text: `${courseInfo.courseCode || 'HANDBOOK'} — ${courseInfo.subjectName || 'Study Guide'}`, style: 'headerMuted', alignment: 'left' },
        { text: 'Notes Forge · Complete Exam Guide', style: 'headerMuted', alignment: 'right' }
      ],
      margin: [50, 25, 50, 0]
    };
  };
};

const createFooter = () => {
  return (currentPage, pageCount) => {
    if (currentPage === 1) return null;
    return {
      columns: [
        { text: 'NOTES FORGE / COMPLETE EXAM GUIDE', style: 'footerMuted', alignment: 'left' },
        { text: `Page ${currentPage} of ${pageCount}`, style: 'footerMuted', alignment: 'right' }
      ],
      margin: [50, 0, 50, 25]
    };
  };
};

// ============================================================================
// MAIN DOCUMENT BUILDER
// ============================================================================

/**
 * Generates the full pdfmake document definition structure.
 */
export const buildPdfDefinition = (subjectName, outline, notesData, masterSummary, syllabusLines, documentAnalysis) => {
  const content = [];

  const analysis = documentAnalysis || {};
  const courseInfo = analysis.courseInfo || { subjectName: subjectName || 'Study Guide' };
  const officialSyllabus = syllabusLines || (analysis.officialSyllabus ? (Array.isArray(analysis.officialSyllabus) ? analysis.officialSyllabus.join('\n') : String(analysis.officialSyllabus)) : 'Syllabus lines were not present in the uploaded presentation.');

  // ========================================================================
  // 1. COVER PAGE
  // ========================================================================
  content.push(...createCoverPage(courseInfo, officialSyllabus, new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })));

  // ========================================================================
  // 2. COURSE DETAILS SECTION (outcomes, assessment, references)
  // ========================================================================
  const courseInfoBlocks = createCourseInfoSection(
    Array.isArray(analysis.courseOutcomes) ? analysis.courseOutcomes : [],
    Array.isArray(analysis.assessmentInfo) ? analysis.assessmentInfo : [],
    Array.isArray(analysis.references) ? analysis.references : []
  );
  if (courseInfoBlocks.length > 0) {
    content.push(...courseInfoBlocks);
  }

  // ========================================================================
  // 3. TABLE OF CONTENTS (Using pdfmake's native TOC)
  // ========================================================================
  content.push(
    {
      toc: {
        title: { text: 'TABLE OF CONTENTS', style: 'sectionHeader', margin: [0, 20, 0, 10] },
        textStyle: { fontSize: 11, color: '#3f3f46' },
        numberStyle: { fontSize: 11, color: COLORS.textMuted, bold: true }
      }
    },
    { text: '', pageBreak: 'after' }
  );

  // ========================================================================
  // 4. CHAPTER 1: How to Use This Guide + Exam Priority Map
  // ========================================================================
  content.push(...createChapterHeader('Chapter 1', 'How to Use this Guide & Exam Priority Map'));

  content.push({
    text: 'This evidence-based priority map lists every topic in the syllabus along with its exam relevance and source evidence. Use the priority levels to allocate your study time effectively.',
    style: 'calloutText',
    margin: [0, 0, 0, 14]
  });

  // Render Priority Map Table
  const priorityHeaders = ['Topic', 'Source Evidence', 'Priority', 'Reason'];
  const priorityRows = [];
  (outline || []).forEach(unit => {
    (unit.topics || []).forEach(topic => {
      const topicNotes = (notesData || {})[topic.name] || {};
      const priorityVal = topicNotes.priority?.level || topicNotes.priority || 'MEDIUM';
      const evidenceVal = topicNotes.sourceLocation || (topic.pages ? `Pages: ${(topic.pages || []).join(', ') || 'See source'}` : 'Mentioned in source');
      const reasonVal = topicNotes.priority?.reason || 'Moderate conceptual coverage.';

      priorityRows.push([
        topic.name || 'Topic',
        evidenceVal,
        `[${priorityVal}]`,
        reasonVal
      ]);
    });
  });

  if (priorityRows.length > 0) {
    content.push(createTable(priorityHeaders, priorityRows, [110, 100, 65, '*']));
  }

  // Priority Legend
  content.push(
    createCallout('Priority Legend', {
      stack: [
        { text: '■ VERY HIGH: Dedicated across multiple slides + repeated in case studies or tutorial questions.', margin: [0, 2, 0, 2], fontSize: 9 },
        { text: '■ HIGH: Dedicated slide or reused in application/example.', margin: [0, 2, 0, 2], fontSize: 9 },
        { text: '■ MEDIUM: Short concept/list appearing once.', margin: [0, 2, 0, 2], fontSize: 9 },
        { text: '■ LOW: Administrative/background content.', margin: [0, 2, 0, 2], fontSize: 9 }
      ]
    }, COLORS.examTip, COLORS.examTipBg)
  );

  // ========================================================================
  // 5. MAIN CHAPTERS (syllabus topics — natural content flow, NO per-topic page breaks)
  // ========================================================================
  let chCount = 2;
  (outline || []).forEach((unit) => {
    content.push(...createChapterHeader(`Chapter ${chCount}`, unit.unit || 'Unit'));
    chCount++;

    (unit.topics || []).forEach(topic => {
      const topicNotes = (notesData || {})[topic.name];
      if (!topicNotes) return;

      // --- Topic Header ---
      content.push(...createTopicHeader(topicNotes.topicName || topic.name, topicNotes.sourceLocation, topicNotes.priority));

      // --- Introduction ---
      if (topicNotes.introduction) {
        content.push({ text: topicNotes.introduction, style: 'topicDescription', margin: [0, 0, 0, 10], keepWithNext: true });
      }

      // A. Definitions
      if (Array.isArray(topicNotes.definitions) && topicNotes.definitions.length > 0) {
        topicNotes.definitions.forEach(def => {
          if (def) content.push(createDefinitionBox(null, def));
        });
      }

      // B. What the source says
      if (topicNotes.sourceContent && topicNotes.sourceContent.content) {
        content.push(createCallout(topicNotes.sourceContent.heading || "What the source says", topicNotes.sourceContent.content, COLORS.definition, COLORS.definitionBg));
      }

      // C. In very easy words
      if (topicNotes.easyExplanation && topicNotes.easyExplanation.content) {
        content.push(createNoteBox(topicNotes.easyExplanation.content));
      }

      // D. Analogy
      if (topicNotes.analogy) {
        content.push(createCallout('Everyday Analogy', topicNotes.analogy, '#4f46e5', '#f5f3ff'));
      }

      // E. Examples from source
      if (Array.isArray(topicNotes.examples) && topicNotes.examples.length > 0) {
        topicNotes.examples.forEach(ex => {
          if (ex) content.push(createExampleBox(ex));
        });
      }

      // F. Key points
      if (Array.isArray(topicNotes.keyPoints) && topicNotes.keyPoints.length > 0) {
        content.push(
          { text: 'KEY POINTS', style: 'subSectionTitle', keepWithNext: true },
          {
            ul: topicNotes.keyPoints.map(pt => ({ text: pt, style: 'calloutText' })),
            margin: [10, 4, 0, 12]
          }
        );
      }

      // G. Table
      if (topicNotes.table && Array.isArray(topicNotes.table.headers) && topicNotes.table.headers.length > 0) {
        content.push(createTable(topicNotes.table.headers, topicNotes.table.rows || []));
      }

      // H. Diagram
      if (topicNotes.diagram && topicNotes.diagram.svg) {
        content.push(createDiagram(topicNotes.diagram.title || 'Visual Structure', topicNotes.diagram.caption, topicNotes.diagram.svg, topicNotes.diagram.examDrawingSteps));
      }

      // I. Code Example / Pseudocode
      if (topicNotes.codeExample && topicNotes.codeExample.code) {
        content.push(createCodeBlock(topicNotes.codeExample.language || 'code', topicNotes.codeExample.code, topicNotes.codeExample.explanation));
      }

      // J. Worked Example (Numerical)
      if (topicNotes.workedExample && topicNotes.workedExample.formula) {
        content.push(createWorkedExample(topicNotes.workedExample));
      }

      // K. Case Study
      if (topicNotes.caseStudy && topicNotes.caseStudy.title) {
        content.push(createCaseStudy(topicNotes.caseStudy));
      }

      // L. Comparison Table
      if (Array.isArray(topicNotes.comparisons) && topicNotes.comparisons.length > 0) {
        const compHeaders = ['Feature', topicNotes.topicName || 'Concept A', 'Variant / Related'];
        const compRows = topicNotes.comparisons.map(c => [c.feature || '', c.conceptA || '', c.conceptB || '']);
        content.push(
          { text: 'COMPARATIVE ANALYSIS', style: 'subSectionTitle', keepWithNext: true },
          createTable(compHeaders, compRows)
        );
      }

      // M. Memory Tricks
      if (Array.isArray(topicNotes.memoryTricks) && topicNotes.memoryTricks.length > 0) {
        content.push(createMemoryTrickBox(topicNotes.memoryTricks));
      }

      // N. Exam Tips
      if (Array.isArray(topicNotes.examTips) && topicNotes.examTips.length > 0) {
        content.push(createExamTipBox(topicNotes.examTips));
      }

      // O. Common Mistakes
      if (Array.isArray(topicNotes.commonMistakes) && topicNotes.commonMistakes.length > 0) {
        content.push(createCommonMistakeBox(topicNotes.commonMistakes));
      }

      // P. Quick Recall Questions
      if (Array.isArray(topicNotes.quickRecallQuestions) && topicNotes.quickRecallQuestions.length > 0) {
        content.push(createQuickRecallBox(topicNotes.quickRecallQuestions));
      }

      // Q. Exam Questions (per topic)
      if (topicNotes.examQuestions) {
        const examQBlocks = createExamQuestionSection(topicNotes.examQuestions);
        if (examQBlocks.length > 0) {
          content.push(
            { text: 'EXAM PRACTICE QUESTIONS', style: 'subSectionTitle', color: COLORS.primary, keepWithNext: true, margin: [0, 10, 0, 4] },
            ...examQBlocks
          );
        }
      }

      // Thin separator between topics (NOT a page break)
      content.push({
        canvas: [
          { type: 'line', x1: 0, y1: 0, x2: 450, y2: 0, lineWidth: 0.5, lineColor: '#e4e4e7' }
        ],
        margin: [0, 12, 0, 6]
      });
    });
  });

  // ========================================================================
  // 6. FINAL SECTIONS
  // ========================================================================

  // 6.1 TUTORIAL QUESTIONS - FULLY SOLVED
  let tutIdx = 0;
  const tutQuestions = [];
  (outline || []).forEach(unit => {
    (unit.topics || []).forEach(topic => {
      const topicNotes = (notesData || {})[topic.name];
      if (topicNotes && Array.isArray(topicNotes.tutorials) && topicNotes.tutorials.length > 0) {
        topicNotes.tutorials.forEach(tut => {
          tutQuestions.push(createQuestion(tut, tutIdx++));
        });
      }
    });
  });

  if (Array.isArray(analysis.tutorialQuestions) && analysis.tutorialQuestions.length > 0) {
    analysis.tutorialQuestions.forEach(tut => {
      tutQuestions.push(createQuestion(tut, tutIdx++));
    });
  }

  if (tutQuestions.length > 0) {
    content.push(...createChapterHeader('Solved Tutorial Questions', 'Practice Exercises & Case Studies'));
    content.push(...tutQuestions);
  }

  // 6.2 FACT / FORMULA SHEET
  const allFormulaRows = [];
  (outline || []).forEach(unit => {
    (unit.topics || []).forEach(topic => {
      const topicNotes = (notesData || {})[topic.name];
      if (topicNotes && topicNotes.workedExample && topicNotes.workedExample.formula) {
        allFormulaRows.push([
          topicNotes.workedExample.formula,
          topicNotes.workedExample.given || '',
          topic.name
        ]);
      }
    });
  });

  const allDefRows = [];
  if (Array.isArray(analysis.importantDefinitions) && analysis.importantDefinitions.length > 0) {
    analysis.importantDefinitions.forEach(d => {
      if (d.concept && d.definition) allDefRows.push([d.concept, d.definition]);
    });
  }

  if (allFormulaRows.length > 0 || allDefRows.length > 0 || (Array.isArray(analysis.importantNumbers) && analysis.importantNumbers.length > 0)) {
    content.push(...createChapterHeader('Fact & Formula Sheet', 'Critical Quantities, Definitions & Key Facts'));

    if (allDefRows.length > 0) {
      content.push(
        { text: 'KEY DEFINITIONS', style: 'subSectionTitle', keepWithNext: true },
        createTable(['Concept', 'Definition'], allDefRows, [120, '*'])
      );
    }

    if (allFormulaRows.length > 0) {
      content.push(
        { text: 'FORMULAS & CALCULATIONS', style: 'subSectionTitle', keepWithNext: true },
        createTable(['Formula', 'Context', 'Topic'], allFormulaRows, [140, '*', 120])
      );
    }

    if (Array.isArray(analysis.importantNumbers) && analysis.importantNumbers.length > 0) {
      content.push(
        { text: 'IMPORTANT NUMBERS & STATISTICS', style: 'subSectionTitle', keepWithNext: true },
        createTable(['Value', 'Context & Meaning'], analysis.importantNumbers.map(n => [n.number || '', n.context || '']), [100, '*'])
      );
    }
  }

  // 6.3 VIVA QUESTIONS
  const vivaQuestions = (masterSummary && Array.isArray(masterSummary.vivaQuestions)) ? masterSummary.vivaQuestions : [];
  if (vivaQuestions.length > 0) {
    content.push(...createChapterHeader('Viva Practice Questions', 'Typical Short-Answer Assessment Questions'));
    vivaQuestions.forEach((q, idx) => {
      content.push({
        stack: [
          { text: `Q${idx + 1}. ${q.question}`, bold: true, fontSize: 10, margin: [0, 3, 0, 2] },
          q.topic ? { text: `Topic: ${q.topic}`, fontSize: 8, color: COLORS.textLight, italics: true, margin: [0, 0, 0, 2] } : null,
          { text: `Answer: ${q.answer}`, fontSize: 9.5, margin: [0, 2, 0, 6], color: '#374151' }
        ].filter(Boolean),
        margin: [0, 2, 0, 4]
      });
    });
  }

  // 6.4 EXAM ANSWER TEMPLATES
  content.push(...createChapterHeader('Exam Answer Writing Templates', 'Mark-Based Formatting Blueprints'));
  const templates = (masterSummary && masterSummary.examTemplates) ? masterSummary.examTemplates : {};
  content.push(...createAnswerTemplate(templates));

  // 6.5 MEMORY TRICK MASTER LIST
  const memoryTrickMasterList = (masterSummary && Array.isArray(masterSummary.memoryTrickMasterList)) ? masterSummary.memoryTrickMasterList : [];
  if (memoryTrickMasterList.length > 0) {
    content.push(...createChapterHeader('Memory Trick Master List', 'All Mnemonics & Memory Aids'));
    memoryTrickMasterList.forEach(trick => {
      content.push({
        stack: [
          { text: [
            { text: `"${trick.mnemonic}"`, bold: true, color: COLORS.memoryTrick, fontSize: 11 },
            { text: ` — ${trick.meaning}`, fontSize: 10, color: COLORS.textBody }
          ], margin: [0, 4, 0, 2] },
          trick.topic ? { text: `Topic: ${trick.topic}`, fontSize: 8, color: COLORS.textLight, italics: true, margin: [0, 0, 0, 2] } : null,
          trick.explanation ? { text: trick.explanation, fontSize: 9.5, color: '#4b5563', margin: [0, 2, 0, 8] } : null
        ].filter(Boolean),
        margin: [0, 2, 0, 4]
      });
    });
  }

  // 6.6 LAST-MINUTE REVISION SHEET & CHECKLIST
  content.push(...createChapterHeader('Last-Minute Revision & Final Checklist', 'High-Priority Summaries & Verification'));

  const lastMinuteRevision = (masterSummary && Array.isArray(masterSummary.lastMinuteRevision)) ? masterSummary.lastMinuteRevision : [];
  if (lastMinuteRevision.length > 0) {
    content.push({ text: 'RAPID REVIEW — HIGH PRIORITY TOPICS', style: 'subSectionTitle', keepWithNext: true });
    lastMinuteRevision.forEach(rev => {
      content.push(
        createCallout(rev.topicName || 'Revision Topic', {
          stack: [
            rev.priority ? { text: `Priority: [${rev.priority}]`, fontSize: 9, bold: true, color: COLORS.commonMistake, margin: [0, 0, 0, 4] } : null,
            { text: `Definition: ${rev.definition || ''}`, margin: [0, 2, 0, 4] },
            rev.keyFormula && rev.keyFormula !== 'N/A' ? { text: `Key Formula: ${rev.keyFormula}`, bold: true, margin: [0, 2, 0, 4] } : null,
            rev.diagramNeeded && rev.diagramNeeded !== 'N/A' ? { text: `Diagram to practice: ${rev.diagramNeeded}`, fontSize: 9, color: COLORS.textMuted, margin: [0, 2, 0, 4] } : null,
            { text: `Exam Reminder: ${rev.highPriorityPoint || ''}`, bold: true, color: COLORS.commonMistake, margin: [0, 4, 0, 0] }
          ].filter(Boolean)
        }, COLORS.commonMistake, COLORS.commonMistakeBg)
      );
    });
  }

  const checklist = (masterSummary && Array.isArray(masterSummary.finalChecklist)) ? masterSummary.finalChecklist : [];
  if (checklist.length > 0) {
    content.push({ text: '10-MINUTE FINAL EXAM CHECKLIST', style: 'subSectionTitle', margin: [0, 16, 0, 6], keepWithNext: true });
    content.push(createRevisionChecklist(checklist));
  }

  // 6.7 MASTER REVISION SUMMARY TABLE (at the very end)
  content.push(
    { text: 'MASTER REVISION SUMMARY', style: 'sectionHeader', margin: [0, 30, 0, 6], tocItem: true },
    { text: 'Core Takeaways & Revision Quick Reference', style: 'subtitle', margin: [0, 0, 0, 16] }
  );

  const summaryTable = (masterSummary && Array.isArray(masterSummary.summaryTable)) ? masterSummary.summaryTable : [];
  if (summaryTable.length > 0) {
    const summaryHeaders = ['Topic', 'Core Takeaway', 'Key Metric / Formula', 'Exam Tip'];
    const summaryRows = summaryTable.map(row => [
      row.topic || '',
      row.coreTakeaway || '',
      row.criticalMetric || '',
      row.examTip || ''
    ]);
    content.push(createTable(summaryHeaders, summaryRows, [90, '*', 110, '*']));
  }

  // ========================================================================
  // DOCUMENT DEFINITION
  // ========================================================================
  return {
    content,
    pageMargins: [50, 60, 50, 60],
    header: createHeader(courseInfo),
    footer: createFooter(),
    styles: {
      coverTitle: {
        font: 'Roboto',
        fontSize: 32,
        bold: true,
        color: COLORS.headerDark,
        alignment: 'left',
        margin: [0, 8, 0, 5]
      },
      coverSubtitle: {
        font: 'Roboto',
        fontSize: 12,
        bold: true,
        color: COLORS.textMuted,
        alignment: 'left',
        letterSpacing: 1.5
      },
      coverMeta: {
        fontSize: 11,
        color: COLORS.headerDark,
        margin: [0, 30, 0, 0]
      },
      coverMetaMuted: {
        fontSize: 10,
        color: COLORS.textMuted,
        margin: [0, 4, 0, 0]
      },
      sectionHeader: {
        fontSize: 22,
        bold: true,
        color: COLORS.headerDark,
        letterSpacing: 1
      },
      subtitle: {
        fontSize: 12,
        color: COLORS.textMuted
      },
      tocUnit: {
        fontSize: 14,
        bold: true,
        color: COLORS.headerDark,
        margin: [0, 12, 0, 4]
      },
      tocTopic: {
        fontSize: 11,
        color: '#3f3f46',
        margin: [10, 2, 0, 2]
      },
      tocPage: {
        fontSize: 11,
        color: COLORS.textMuted,
        margin: [0, 2, 0, 2]
      },
      unitLabel: {
        fontSize: 10,
        bold: true,
        letterSpacing: 1.5,
        margin: [0, 40, 0, 2]
      },
      unitTitle: {
        fontSize: 24,
        bold: true,
        color: COLORS.headerDark
      },
      topicLabel: {
        fontSize: 9,
        bold: true,
        color: COLORS.textMuted,
        letterSpacing: 1,
        margin: [0, 10, 0, 2]
      },
      topicTitle: {
        fontSize: 19,
        bold: true,
        color: COLORS.headerDark
      },
      topicDescription: {
        fontSize: 10.5,
        color: COLORS.textMuted,
        italics: true
      },
      subSectionTitle: {
        fontSize: 10.5,
        bold: true,
        color: COLORS.textMuted,
        letterSpacing: 1,
        margin: [0, 12, 0, 5]
      },
      calloutTitle: {
        fontSize: 9,
        bold: true,
        letterSpacing: 1
      },
      calloutText: {
        fontSize: 10,
        color: COLORS.textBody,
        lineHeight: 1.4,
        margin: [0, 3, 0, 0]
      },
      codeHeader: {
        fontSize: 8,
        bold: true,
        color: COLORS.textMuted,
        letterSpacing: 1,
        margin: [0, 0, 0, 4]
      },
      codeBody: {
        fontSize: 8.5,
        color: COLORS.codeText,
        lineHeight: 1.35
      },
      codeExplanation: {
        fontSize: 9.5,
        color: COLORS.textMuted,
        lineHeight: 1.35
      },
      tableHeader: {
        fontSize: 9.5,
        bold: true,
        color: COLORS.white,
        margin: [6, 5, 6, 5]
      },
      tableCell: {
        fontSize: 9,
        color: COLORS.textBody,
        margin: [6, 4, 6, 4],
        lineHeight: 1.3
      },
      headerMuted: {
        fontSize: 8,
        color: COLORS.textLight
      },
      footerMuted: {
        fontSize: 8,
        color: COLORS.textLight
      }
    }
  };
};

/**
 * Downloads the generated PDF guide.
 */
export const downloadPdfGuide = (subjectName, outline, notesData, masterSummary, syllabusLines, documentAnalysis) => {
  try {
    const safeSubjectName = subjectName || 'Study_Guide';
    const safeNotesData = notesData || {};
    const safeMasterSummary = masterSummary || {};
    const safeOutline = outline || [];

    const docDefinition = buildPdfDefinition(
      safeSubjectName,
      safeOutline,
      safeNotesData,
      safeMasterSummary,
      syllabusLines,
      documentAnalysis
    );

    // Resolve pdfMake object across ESM, default export, and window globals
    let pdfMakeInst = pdfMake;
    if (!pdfMakeInst || typeof pdfMakeInst.createPdf !== 'function') {
      if (pdfMake && pdfMake.default && typeof pdfMake.default.createPdf !== 'function') {
        pdfMakeInst = pdfMake.default;
      } else if (typeof window !== 'undefined' && window.pdfMake && typeof window.pdfMake.createPdf === 'function') {
        pdfMakeInst = window.pdfMake;
      }
    }

    // Ensure virtual font filesystem (vfs) is attached
    if (pdfMakeInst && !pdfMakeInst.vfs) {
      if (pdfFonts && pdfFonts.pdfMake && pdfFonts.pdfMake.vfs) {
        pdfMakeInst.vfs = pdfFonts.pdfMake.vfs;
      } else if (pdfFonts && pdfFonts.vfs) {
        pdfMakeInst.vfs = pdfFonts.vfs;
      } else if (pdfFonts) {
        pdfMakeInst.vfs = pdfFonts;
      }
    }

    const fileName = `${safeSubjectName.replace(/[^a-zA-Z0-9_-]/g, '_')}_study_guide.pdf`;
    pdfMakeInst.createPdf(docDefinition).download(fileName);
  } catch (err) {
    console.error('Error generating PDF:', err);
    alert(`Error creating PDF download: ${err.message}`);
  }
};
