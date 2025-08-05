//background.js

console.log('Background script loaded.');

// Cached configuration for API calls
let cachedConfig = null;

// Create context menu items when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed.');

  // Remove any existing context menus to prevent duplicates
  chrome.contextMenus.removeAll(() => {
    // Context menu for bulleting the entire page
    chrome.contextMenus.create({
      id: "bulletPage",
      title: "Bullet page",
      contexts: ["all"]
    });

    // Context menu for bulleting selected text
    chrome.contextMenus.create({
      id: "bulletSelection",
      title: "Bullet selection",
      contexts: ["selection"]
    });
  });
});

// Handle context menu item clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log('Context menu item clicked:', info.menuItemId);
  if (info.menuItemId === "bulletPage" || info.menuItemId === "bulletSelection") {
    // First, inject the content script into the tab
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    }, () => {
      // Now send the message to the content script
      console.log('Sending message to content script.');
      chrome.tabs.sendMessage(tab.id, {
        action: info.menuItemId === "bulletPage" ? 'summarizePage' : 'summarizeSelection'
      });
    });
  }
});

// Listen for connections from content script
chrome.runtime.onConnect.addListener(function(port) {
  console.log('Connected to port:', port.name);
  if (port.name === 'openai') {
    port.onMessage.addListener(function(msg) {
      if (msg.action === 'callOpenAI' && msg.text) {
        callOpenAIStream(msg.text, port);
      } else if (msg.action === 'generateTitle' && msg.summary) {
        generateTitle(msg.summary, port);
      } else if (msg.action === 'callOpenAIContext' && msg.text) {
        callOpenAIContextStream(msg.text, port);
      }
    });
  }
});

/**
 * Retrieve configuration settings (with caching).
 */
async function getConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  cachedConfig = new Promise((resolve) => {
    chrome.storage.local.get(['customApiKey'], (data) => {
      resolve({
        API_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/chat/completions',
        MODEL: 'gemini-2.5-flash-lite',
        TIMEOUT_MS: 30000,
        TEMPERATURE: 0.7,
        API_KEY: data.customApiKey || 'api-key'
      });
    });
  });
  return cachedConfig;
}

/**
 * Consolidated error handler for API fetch responses.
 */
async function handleErrorResponse(response, port) {
  try {
    const text = await response.text();
    console.error('Error response body:', text);
    let errorMsg = text;
    try {
      const errorData = JSON.parse(text);
      errorMsg = errorData.error?.message || text;
      console.error('Parsed error data:', errorData);
    } catch (e) {
      console.error('Error parsing error response:', e);
    }
    port.postMessage({ type: 'error', error: errorMsg });
  } catch (e) {
    console.error('Error handling error response:', e);
    port.postMessage({ type: 'error', error: 'Unknown error occurred' });
  }
}

/**
 * Call OpenAI API with streaming using async/await.
 */
async function callOpenAIStream(text, port) {
  const CONFIG = await getConfig();
  
  console.log('Starting API call with config:', {
    endpoint: CONFIG.API_ENDPOINT,
    model: CONFIG.MODEL,
    textLength: text.length
  });
  
  if (!text || !port) {
    console.error('Missing required parameters');
    port?.postMessage({ type: 'error', error: 'Invalid parameters for API call' });
    return;
  }

  // Use the prompt template for summarization
  const prompt = PROMPT_TEMPLATES.summarize(text);

  // Set up a timeout for the fetch
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  const body = JSON.stringify({
    model: CONFIG.MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: CONFIG.TEMPERATURE,
    stream: true
  });
  console.log('Request body:', body);

  try {
    const response = await fetch(CONFIG.API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.API_KEY}`
      },
      body,
      signal: controller.signal
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      await handleErrorResponse(response, port);
    } else {
      // Process the streamed response using a while loop
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          port.postMessage({ type: 'done' });
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');
        for (const line of lines) {
          const message = line.replace(/^data: /, '');
          if (message === '[DONE]') {
            port.postMessage({ type: 'done' });
            return;
          }
          try {
            const parsed = JSON.parse(message);
            const content = parsed.choices[0].delta.content;
            if (content) {
              // Buffer and clean content before sending
              const cleanedContent = bufferAndCleanContent(content);
              if (cleanedContent) {
                port.postMessage({ type: 'data', content: cleanedContent });
              }
            }
          } catch (error) {
            console.error('Error parsing JSON:', error);
          }
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Request timed out');
      port.postMessage({ type: 'error', error: 'Request timed out after 30 seconds' });
    } else {
      console.error('Error calling Gemini API:', error);
      port.postMessage({ type: 'error', error: error.toString() });
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate title from summary using async/await.
 */
async function generateTitle(summary, port) {
  const CONFIG = await getConfig();
  console.log('Starting title generation...');
  
  const prompt = PROMPT_TEMPLATES.generateTitle(summary);

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.API_KEY}`
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash-lite',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7
      })
    });
    const data = await response.json();
    console.log('API response:', data);

    // Extract title using the expected response format
    const title = data.choices?.[0]?.message?.content;
    if (!title) {
      throw new Error('No title found in response');
    }

    // Clean and process the title
    const cleanTitle = title
      .replace(/['"]/g, '')
      .replace(/\n/g, ' ')
      .replace(/^Title: /i, '')
      .trim();
    
    console.log('Final processed title:', cleanTitle);
    port.postMessage({ type: 'title', title: cleanTitle });
  } catch (error) {
    console.error('Error in title generation:', error);
    port.postMessage({ type: 'error', error: error.toString() });
  }
}

/**
 * Call the API for providing context (with streaming) using async/await.
 */
async function callOpenAIContextStream(text, port) {
  const CONFIG = await getConfig();
  
  console.log('Starting context API call with config:', {
    endpoint: CONFIG.API_ENDPOINT,
    model: CONFIG.MODEL,
    textLength: text.length
  });
  
  if (!text || !port) {
    console.error('Missing required parameters for context API call');
    port?.postMessage({ type: 'error', error: 'Invalid parameters for context API call' });
    return;
  }
  
  // Use the prompt template for providing context information
  const prompt = PROMPT_TEMPLATES.provideContext(text);
  
  // Set up an abort controller with a timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);
  
  const body = JSON.stringify({
    model: CONFIG.MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: CONFIG.TEMPERATURE,
    stream: true
  });
  console.log('Context request body:', body);
  
  try {
    const response = await fetch(CONFIG.API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.API_KEY}`
      },
      body,
      signal: controller.signal
    });
    console.log('Context response status:', response.status);
    
    if (!response.ok) {
      await handleErrorResponse(response, port);
    } else {
      // Process the streamed response using a while loop
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          port.postMessage({ type: 'done' });
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');
        for (const line of lines) {
          const message = line.replace(/^data: /, '');
          if (message === '[DONE]') {
            port.postMessage({ type: 'done' });
            return;
          }
          try {
            const parsed = JSON.parse(message);
            const content = parsed.choices[0].delta.content;
            if (content) {
              const cleanedContent = bufferAndCleanContent(content);
              if (cleanedContent) {
                port.postMessage({ type: 'data', content: cleanedContent });
              }
            }
          } catch (error) {
            console.error('Error parsing JSON (context):', error);
          }
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Context request timed out');
      port.postMessage({ type: 'error', error: 'Request timed out after 30 seconds' });
    } else {
      console.error('Error calling context API:', error);
      port.postMessage({ type: 'error', error: error.toString() });
    }
  } finally {
    clearTimeout(timeout);
  }
}

// Prompt templates used for summarization, title generation, and providing context
const PROMPT_TEMPLATES = {
  summarize: (text) => `You are an expert reporter tasked with creating clear, engaging, and informative outlines of various texts. Your goal is to capture the most important details while presenting them in a structured and easily digestible format.

Please follow these steps to create your summary:

1. Carefully read through the entire text and:
   a. Identify the key takeaways in the text.
   b. For each takeaway, identify the most important and interesting points.
   c. Present each point clearly and concisely, using analogies or relatable examples.
   d. Ensure you're capturing the most salient details from the original text.
   e. Check that each point can be expressed concisely in 1-2 lines (15-30 words).

Based on your analysis, create a structured outline summary following these rules:
   - The firstsection title is "Title: Key Takeaways".
   - The following sections go into more detail on each takeaway.
   - Start each section with "Title: " followed by title of the takeaway.
   - Use bullet points (•) for each key point under a title.
   - Keep points concise (1-2 lines) and engaging.
   - End each point with a period.
   - Do not use sub-bullets or nested points.
   - Do not use any extra formatting or special characters.

Your final output should follow this exact format:

Title: [Key takeaways]
• takeaway 1
• takeaway 2
...

Title: next takeaways
• [Point 1]
• [Point 2]

...

Remember to make your summary engaging and informative, capturing the most important details from the original text while tailoring it to the target audience. It is essential for you not to repeat yourself.
Here is the text you need to summarize:
${text}`,

  generateTitle: (summary) => `Create a short title (3-7 words) that captures the main topic.
Only output the title itself, with no prefix or formatting.

Text to summarize:
${summary.slice(0, 500)}`,

  provideContext: (text) => `Provide background information about the topic, that's not in the article. If the event has a long timeline, explain the last significant events leading up to it. Be concise and to the point. Use bullet points, but no ** or sub-bullets.
Your final output should follow this exact format:

   - Start each section with "Title: " followed by title of the section.
   - Use bullet points (•) for each key point under a title.
   - Keep points concise (3-5 lines) and engaging.
   - End each point with a period.
   - Do not use sub-bullets or nested points.
   - Do not use any extra formatting or special characters.

Here is an example of the format you should follow:

Title: [Background information]
• background 1
• background 2
...
Title: [Approximate Timeline]
• Event 1
• Event 2
...

Here is the text you need to provide background information for:
${text}`
};

// Global variables and helper functions for content buffering
let contentBuffer = '';
const WORD_BOUNDARY_REGEX = /\b|\s+|[.,!?;:]|\n/;
const FORMAT_MARKERS = /^(Title:|•|-|\*)/;

/**
 * Buffer and clean content received via streaming.
 * Preserves formatting markers and processes complete lines.
 */
function bufferAndCleanContent(content) {
  contentBuffer += content;
  
  // Look for complete lines and formatting markers
  const lines = contentBuffer.split('\n');
  
  // Keep the last line in the buffer if it's incomplete
  const lastLine = lines[lines.length - 1];
  if (!lastLine.match(FORMAT_MARKERS) && !lastLine.trim().endsWith('.')) {
    contentBuffer = lines.pop() || '';
  } else {
    contentBuffer = '';
  }
  
  // Process complete lines
  if (lines.length === 0) return '';
  
  return lines
    .map(line => {
      // Preserve formatting markers
      const formatMatch = line.match(FORMAT_MARKERS);
      const prefix = formatMatch ? formatMatch[0] : '';
      const rest = line.slice(prefix.length);
      
      // Clean the content while preserving the prefix
      const cleanedRest = cleanContent(rest);
      return prefix + cleanedRest;
    })
    .join('\n');
}

/**
 * Normalize content by reducing multiple spaces to a single space.
 */
function cleanContent(content) {
  return content.replace(/\s+/g, ' ');
}

// Optimize the Save Note logic using async/await for asynchronous operations
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveNote') {
    console.log('Received save note request:', request.note);

    (async () => {
      try {
        if (!request.note || !request.note.title || !request.note.content) {
          throw new Error('Invalid note data');
        }
        const savedNotes = await new Promise((resolve, reject) => {
          chrome.storage.local.get('savedNotes', (data) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(data.savedNotes || []);
            }
          });
        });

        savedNotes.push(request.note);

        await new Promise((resolve, reject) => {
          chrome.storage.local.set({ savedNotes }, () => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        });

        console.log('Note saved successfully');
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error saving note:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep the message channel open for async response
  }
});
