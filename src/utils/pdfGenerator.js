import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

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

/**
 * Creates a colored callout box with a thick left border.
 * Uses a 2-column borderless table layout to simulate a left border with background color.
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
    margin: [0, 8, 0, 12]
  };
};

/**
 * Clean SVG tags from generated content to prevent rendering issues in pdfmake.
 */
const cleanSvg = (svgString) => {
  if (!svgString) return '';
  // Ensure the SVG starts with <svg and ends with </svg>
  const match = svgString.match(/<svg[\s\S]*?<\/svg>/);
  if (!match) return '';
  let svg = match[0];
  // Replace xmlns if missing or duplicate
  if (!svg.includes('xmlns=')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return svg;
};

/**
 * Generates the full pdfmake document definition structure.
 */
export const buildPdfDefinition = (subjectName, outline, notesData, masterSummary) => {
  const content = [];

  // 1. COVER PAGE
  content.push(
    { text: '\n\n\n\n\n\n', style: 'spacer' },
    { text: 'NOTES FORGE', style: 'coverSubtitle', color: '#3b82f6' },
    { text: subjectName.toUpperCase(), style: 'coverTitle' },
    { text: 'COMPLETE STUDY GUIDE & EXAM REFERENCE', style: 'coverSubtitle' },
    { 
      canvas: [
        { type: 'line', x1: 0, y1: 0, x2: 450, y2: 0, lineWidth: 3, lineColor: '#3b82f6' }
      ],
      margin: [0, 20, 0, 20]
    },
    { text: `Generated on ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`, style: 'coverMeta' },
    { text: 'Prepared for STEM and Engineering Excellence', style: 'coverMetaMuted' },
    { text: '', pageBreak: 'after' }
  );

  // 2. TABLE OF CONTENTS
  content.push(
    { text: 'TABLE OF CONTENTS', style: 'sectionHeader', margin: [0, 0, 0, 20] },
    { text: 'Outline of Exam Topics', style: 'subtitle', margin: [0, -15, 0, 20] }
  );

  const tocBody = [];
  let currentTopicCount = 1;
  outline.forEach((unit, uIdx) => {
    tocBody.push([
      { text: `Unit ${uIdx + 1}: ${unit.unit}`, style: 'tocUnit', colSpan: 2 },
      {}
    ]);
    unit.topics.forEach(topic => {
      tocBody.push([
        { text: `  •  ${topic.name}`, style: 'tocTopic' },
        { text: `Topic ${currentTopicCount++}`, style: 'tocPage', alignment: 'right' }
      ]);
    });
  });

  content.push({
    table: {
      widths: ['*', 100],
      body: tocBody
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 30]
  });
  content.push({ text: '', pageBreak: 'after' });

  // 3. STUDY NOTES (Topic by Topic)
  let topicIndex = 1;
  outline.forEach((unit, uIdx) => {
    // Unit Divider
    content.push(
      { text: `UNIT ${uIdx + 1}`, style: 'unitLabel', color: '#3b82f6' },
      { text: unit.unit.toUpperCase(), style: 'unitTitle' },
      { 
        canvas: [
          { type: 'line', x1: 0, y1: 0, x2: 450, y2: 0, lineWidth: 1.5, lineColor: '#e4e4e7' }
        ],
        margin: [0, 8, 0, 24]
      }
    );

    unit.topics.forEach(topic => {
      const topicNotes = notesData[topic.name];
      if (!topicNotes) return;

      // Topic Title
      content.push(
        { text: `TOPIC ${topicIndex++}`, style: 'topicLabel' },
        { text: topicNotes.topicName, style: 'topicTitle' },
        { text: topic.description, style: 'topicDescription', margin: [0, -4, 0, 16] }
      );

      // Definition Callout
      content.push(createCallout('Definition', topicNotes.definition, '#0d9488', '#f0fdfa'));

      // Why It Matters Callout
      content.push(createCallout('Why It Matters', topicNotes.whyItMatters, '#2563eb', '#eff6ff'));

      // How It Works
      content.push({ text: 'HOW IT WORKS', style: 'subSectionTitle' });
      const steps = topicNotes.howItWorks.map((step, idx) => ({
        text: [
          { text: `${idx + 1}. `, bold: true, color: '#3b82f6' },
          step
        ],
        margin: [0, 4, 0, 4]
      }));
      content.push({
        stack: steps,
        margin: [0, 4, 0, 16]
      });

      // SVG Diagram
      if (topicNotes.diagramSvg) {
        const svgCleaned = cleanSvg(topicNotes.diagramSvg);
        if (svgCleaned) {
          content.push(
            { text: 'VISUAL STRUCTURE', style: 'subSectionTitle' },
            { 
              svg: svgCleaned, 
              width: 320, 
              alignment: 'center',
              margin: [0, 10, 0, 20]
            }
          );
        }
      }

      // Complexity / Key Metrics
      if (topicNotes.complexity && (topicNotes.complexity.time || topicNotes.complexity.space)) {
        content.push(
          { text: 'COMPLEXITY & METRICS', style: 'subSectionTitle' },
          createCallout('Key Metrics', [
            {
              table: {
                widths: ['auto', '*'],
                body: [
                  [{ text: 'Time Complexity:', bold: true, color: '#6d28d9' }, { text: topicNotes.complexity.time || 'N/A' }],
                  [{ text: 'Space Complexity:', bold: true, color: '#6d28d9' }, { text: topicNotes.complexity.space || 'N/A' }],
                  [{ text: 'Explanation:', bold: true, color: '#6d28d9' }, { text: topicNotes.complexity.explanation || 'N/A' }]
                ]
              },
              layout: 'noBorders',
              margin: [0, 4, 0, 4]
            }
          ], '#6d28d9', '#faf5ff')
        );
      }

      // Code Snippet or Example
      if (topicNotes.codeSnippet && topicNotes.codeSnippet.code) {
        const isNone = topicNotes.codeSnippet.language === 'none';
        content.push(
          { text: isNone ? 'WORKED EXAMPLE' : 'IMPLEMENTATION / CODE', style: 'subSectionTitle' },
          {
            table: {
              widths: ['*'],
              body: [
                [
                  {
                    stack: [
                      { text: isNone ? 'Numerical Walkthrough' : topicNotes.codeSnippet.language.toUpperCase(), style: 'codeHeader' },
                      { text: topicNotes.codeSnippet.code, style: 'codeBody' }
                    ],
                    fillColor: '#18181b',
                    margin: [12, 10, 12, 10]
                  }
                ]
              ]
            },
            layout: 'noBorders',
            margin: [0, 4, 0, 8]
          },
          { text: topicNotes.codeSnippet.explanation, style: 'codeExplanation', margin: [4, 0, 4, 16] }
        );
      }

      // Comparisons Table
      if (topicNotes.comparisons && topicNotes.comparisons.length > 0) {
        content.push({ text: 'COMPARATIVE ANALYSIS', style: 'subSectionTitle' });
        
        const headers = [
          { text: 'Feature', style: 'tableHeader' },
          { text: topicNotes.topicName, style: 'tableHeader' },
          { text: 'Variant / Related', style: 'tableHeader' }
        ];

        const rows = topicNotes.comparisons.map(c => [
          { text: c.feature, bold: true, style: 'tableCell' },
          { text: c.conceptA, style: 'tableCell' },
          { text: c.conceptB, style: 'tableCell' }
        ]);

        content.push({
          table: {
            headerRows: 1,
            widths: [100, '*', '*'],
            body: [headers, ...rows]
          },
          layout: {
            fillColor: (rowIndex) => rowIndex === 0 ? '#3b82f6' : (rowIndex % 2 === 0 ? '#f4f4f5' : null),
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#e4e4e7',
            vLineColor: () => '#e4e4e7'
          },
          margin: [0, 4, 0, 16]
        });
      }

      // Exam Focus / Common Mistakes
      if (topicNotes.examFocus && topicNotes.examFocus.length > 0) {
        const examTips = topicNotes.examFocus.map(tip => ({
          text: `•  ${tip}`,
          style: 'calloutText',
          margin: [0, 2, 0, 2]
        }));
        content.push(createCallout('Exam Focus & Tips', { stack: examTips }, '#d97706', '#fef3c7'));
      }

      // Spacer before next topic
      content.push({ text: '', pageBreak: 'after' });
    });
  });

  // 4. MASTER SUMMARY CHEAT-SHEET
  content.push(
    { text: 'MASTER REVISION SHEET', style: 'sectionHeader', margin: [0, 0, 0, 20] },
    { text: 'Core Takeaways & Revision Formulas', style: 'subtitle', margin: [0, -15, 0, 20] }
  );

  const summaryHeaders = [
    { text: 'Topic', style: 'tableHeader' },
    { text: 'Core Takeaway', style: 'tableHeader' },
    { text: 'Key Complexities / Formulas', style: 'tableHeader' },
    { text: 'Revision Tip', style: 'tableHeader' }
  ];

  const summaryRows = masterSummary.map(row => [
    { text: row.topic, bold: true, style: 'tableCell' },
    { text: row.coreTakeaway, style: 'tableCell' },
    { text: row.criticalMetric, style: 'tableCell' },
    { text: row.examTip, style: 'tableCell' }
  ]);

  content.push({
    table: {
      headerRows: 1,
      widths: [90, '*', 110, '*'],
      body: [summaryHeaders, ...summaryRows]
    },
    layout: {
      fillColor: (rowIndex) => rowIndex === 0 ? '#18181b' : (rowIndex % 2 === 0 ? '#f4f4f5' : null),
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#e4e4e7',
      vLineColor: () => '#e4e4e7'
    },
    margin: [0, 10, 0, 20]
  });

  return {
    content,
    pageMargins: [50, 60, 50, 60],
    header: (currentPage) => {
      if (currentPage === 1) return null; // No header on cover
      return {
        columns: [
          { text: 'Notes Forge Study Guide', style: 'headerMuted', alignment: 'left' },
          { text: subjectName.toUpperCase(), style: 'headerMuted', alignment: 'right' }
        ],
        margin: [50, 25, 50, 0]
      };
    },
    footer: (currentPage, pageCount) => {
      if (currentPage === 1) return null; // No footer on cover
      return {
        columns: [
          { text: 'Selectable Text Premium PDF', style: 'footerMuted', alignment: 'left' },
          { text: `Page ${currentPage} of ${pageCount}`, style: 'footerMuted', alignment: 'right' }
        ],
        margin: [50, 0, 50, 25]
      };
    },
    styles: {
      coverTitle: {
        font: 'Roboto',
        fontSize: 34,
        bold: true,
        color: '#18181b',
        alignment: 'left',
        margin: [0, 10, 0, 5]
      },
      coverSubtitle: {
        font: 'Roboto',
        fontSize: 12,
        bold: true,
        color: '#71717a',
        alignment: 'left',
        letterSpacing: 1.5
      },
      coverMeta: {
        fontSize: 11,
        color: '#18181b',
        margin: [0, 40, 0, 0]
      },
      coverMetaMuted: {
        fontSize: 10,
        color: '#71717a',
        margin: [0, 4, 0, 0]
      },
      sectionHeader: {
        fontSize: 22,
        bold: true,
        color: '#18181b',
        letterSpacing: 1
      },
      subtitle: {
        fontSize: 12,
        color: '#71717a'
      },
      tocUnit: {
        fontSize: 14,
        bold: true,
        color: '#18181b',
        margin: [0, 12, 0, 4]
      },
      tocTopic: {
        fontSize: 11,
        color: '#3f3f46',
        margin: [10, 2, 0, 2]
      },
      tocPage: {
        fontSize: 11,
        color: '#71717a',
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
        color: '#18181b'
      },
      topicLabel: {
        fontSize: 9,
        bold: true,
        color: '#71717a',
        letterSpacing: 1,
        margin: [0, 10, 0, 2]
      },
      topicTitle: {
        fontSize: 20,
        bold: true,
        color: '#18181b'
      },
      topicDescription: {
        fontSize: 11,
        color: '#71717a',
        italics: true
      },
      subSectionTitle: {
        fontSize: 11,
        bold: true,
        color: '#71717a',
        letterSpacing: 1,
        margin: [0, 16, 0, 6]
      },
      calloutTitle: {
        fontSize: 9,
        bold: true,
        letterSpacing: 1
      },
      calloutText: {
        fontSize: 10.5,
        color: '#27272a',
        lineHeight: 1.4,
        margin: [0, 4, 0, 0]
      },
      codeHeader: {
        fontSize: 8,
        bold: true,
        color: '#71717a',
        letterSpacing: 1,
        margin: [0, 0, 0, 4]
      },
      codeBody: {
        font: 'Courier',
        fontSize: 9,
        color: '#f4f4f5',
        lineHeight: 1.35
      },
      codeExplanation: {
        fontSize: 9.5,
        color: '#71717a',
        lineHeight: 1.35
      },
      tableHeader: {
        fontSize: 10,
        bold: true,
        color: '#ffffff',
        margin: [6, 4, 6, 4]
      },
      tableCell: {
        fontSize: 9.5,
        color: '#27272a',
        margin: [6, 4, 6, 4],
        lineHeight: 1.3
      },
      headerMuted: {
        fontSize: 8,
        color: '#a1a1aa'
      },
      footerMuted: {
        fontSize: 8,
        color: '#a1a1aa'
      }
    }
  };
};

/**
 * Downloads the generated PDF guide.
 */
export const downloadPdfGuide = (subjectName, outline, notesData, masterSummary) => {
  const docDefinition = buildPdfDefinition(subjectName, outline, notesData, masterSummary);
  pdfMake.createPdf(docDefinition).download(`${subjectName.replace(/\s+/g, '_')}_study_guide.pdf`);
};
