import JSZip from 'jszip';

/**
 * Decodes standard XML/HTML entities.
 */
const decodeEntities = (text) => {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
};

/**
 * Extracts text from a slide XML or notesSlide XML using regex matching.
 */
const extractTextFromXml = (xmlString) => {
  if (!xmlString) return '';
  // Match text nodes in PowerPoint: <a:t>Content</a:t>
  const matches = xmlString.match(/<a:t>([\s\S]*?)<\/a:t>/g) || [];
  return matches
    .map(match => {
      const content = match.replace(/<\/?a:t>/g, '');
      return decodeEntities(content);
    })
    .filter(text => text.trim().length > 0)
    .join(' ');
};

/**
 * Parses PPTX files slide by slide, including speaker notes.
 */
const parsePPTX = async (fileBuffer) => {
  const zip = await JSZip.loadAsync(fileBuffer);
  
  // Find and sort slides numerically
  const slideNames = Object.keys(zip.files)
    .filter(name => name.match(/^ppt\/slides\/slide\d+\.xml$/))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)[0], 10);
      const numB = parseInt(b.match(/\d+/)[0], 10);
      return numA - numB;
    });

  const pages = [];

  for (let i = 0; i < slideNames.length; i++) {
    const slideName = slideNames[i];
    const slideNum = parseInt(slideName.match(/\d+/)[0], 10);
    const slideXml = await zip.files[slideName].async('text');
    const slideText = extractTextFromXml(slideXml);

    // Try to find matching speaker notes: notesSlide{slideNum}.xml
    let notesText = '';
    const notesName = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    if (zip.files[notesName]) {
      const notesXml = await zip.files[notesName].async('text');
      notesText = extractTextFromXml(notesXml);
    } else {
      const alternativeNotesName = Object.keys(zip.files).find(name => 
        name.includes(`notesSlide${slideNum}.xml`) || name.includes(`notesSlide${i + 1}.xml`)
      );
      if (alternativeNotesName) {
        const notesXml = await zip.files[alternativeNotesName].async('text');
        notesText = extractTextFromXml(notesXml);
      }
    }

    const lines = slideText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const title = lines[0] ? (lines[0].length < 60 ? lines[0] : `Slide ${i + 1}`) : `Slide ${i + 1}`;

    const combinedContent = [
      `[SLIDE CONTENT]\n${slideText}`,
      notesText ? `[SPEAKER NOTES]\n${notesText}` : ''
    ].filter(Boolean).join('\n\n');

    pages.push({
      pageNumber: i + 1,
      title: title,
      content: combinedContent
    });
  }

  return pages;
};

/**
 * Converts a file object directly to a Base64 encoded string.
 */
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Main file parsing interface.
 * Returns either:
 * - For PDF: { type: 'pdf', base64: string, name: string }
 * - For PPTX: { type: 'pptx', pages: [...] }
 */
export const parseFileContent = async (file) => {
  const fileExtension = file.name.split('.').pop().toLowerCase();

  if (fileExtension === 'pdf') {
    const base64 = await fileToBase64(file);
    return {
      type: 'pdf',
      base64,
      name: file.name
    };
  } else if (fileExtension === 'pptx') {
    const arrayBuffer = await file.arrayBuffer();
    const pages = await parsePPTX(arrayBuffer);
    return {
      type: 'pptx',
      pages
    };
  } else {
    throw new Error('Unsupported file type. Please upload a PDF or PPTX file.');
  }
};
