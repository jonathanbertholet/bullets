//background.js

console.log('Background script loaded.');

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
      }
    });
  }
});

// Function to call OpenAI API with streaming
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

  // Use the prompt template instead of defining it inline
  const prompt = PROMPT_TEMPLATES.summarize(text);

  // Add timeout to fetch
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  const body = JSON.stringify({
    model: CONFIG.MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: CONFIG.TEMPERATURE,
    stream: true
  });
  console.log('Request body:', body);

  fetch(CONFIG.API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.API_KEY}`
    },
    body,
    signal: controller.signal
  })
  .then(response => {
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      response.text().then(text => {
        console.error('Error response body:', text);
        try {
          const errorData = JSON.parse(text);
          console.error('Parsed error data:', errorData);
          port.postMessage({ type: 'error', error: errorData.error?.message || text });
        } catch (e) {
          console.error('Error parsing error response:', e);
          port.postMessage({ type: 'error', error: text });
        }
      });
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      function read() {
        reader.read().then(({ done, value }) => {
          if (done) {
            port.postMessage({ type: 'done' });
            return;
          }
          const chunk = decoder.decode(value, { stream: true });
          // Parse the chunk and extract the content
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
                // Buffer the content before sending
                const cleanedContent = bufferAndCleanContent(content);
                if (cleanedContent) {
                  port.postMessage({ type: 'data', content: cleanedContent });
                }
              }
            } catch (error) {
              console.error('Error parsing JSON:', error);
            }
          }
          read();
        }).catch(error => {
          console.error('Error reading stream:', error);
          port.postMessage({ type: 'error', error: error.toString() });
        });
      }
      read();
    }
  })
  .catch(error => {
    if (error.name === 'AbortError') {
      console.error('Request timed out');
      port.postMessage({ type: 'error', error: 'Request timed out after 30 seconds' });
    } else {
      console.error('Error calling Gemini API:', error);
      port.postMessage({ type: 'error', error: error.toString() });
    }
  })
  .finally(() => {
    clearTimeout(timeout);
  });
}

// Function to generate title from summary
async function generateTitle(summary, port) {
  const CONFIG = await getConfig();
  console.log('Starting title generation...');
  
  const prompt = PROMPT_TEMPLATES.generateTitle(summary);

  fetch('https://generativelanguage.googleapis.com/v1beta/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.API_KEY}`
    },
    body: JSON.stringify({
      model: 'gemini-2.0-flash-exp',
      messages: [{ 
        role: 'user', 
        content: prompt 
      }],
      temperature: 0.7
    })
  })
  .then(response => response.json())
  .then(data => {
    console.log('API response:', data);
    
    // Extract title using the correct response format
    const title = data.choices?.[0]?.message?.content;
    
    if (!title) {
      throw new Error('No title found in response');
    }
    
    // Clean up the title
    const cleanTitle = title
      .replace(/['"]/g, '')    // Remove quotes
      .replace(/\n/g, ' ')     // Remove newlines
      .replace(/^Title: /i, '') // Remove "Title:" prefix if present
      .trim();
    
    console.log('Final processed title:', cleanTitle);
    port.postMessage({ type: 'title', title: cleanTitle });
  })
  .catch(error => {
    console.error('Error in title generation:', error);
    port.postMessage({ type: 'error', error: error.toString() });
  });
}

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

Remember to make your summary engaging and informative, capturing the most important details from the original text while tailoring it to the target audience and making sure not to repeat yourself.
Here is the text you need to summarize:
${text}`,

  generateTitle: (summary) => `Create a short title (3-7 words) that captures the main topic.
Only output the title itself, with no prefix or formatting.

Text to summarize:
${summary.slice(0, 500)}`
};

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['customApiKey'], (data) => {
      resolve({
        API_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/chat/completions',
        MODEL: 'gemini-1.5-flash-8b',
        TIMEOUT_MS: 30000,
        TEMPERATURE: 0.7,
        API_KEY: data.customApiKey || ''
      });
    });
  });
}

const ERROR_MESSAGES = {
  NO_API_KEY: 'No API key found. Please set your API key in the extension settings.',
  TIMEOUT: 'Request timed out, check internet connection or contact me through Github',
  INVALID_PARAMS: 'Invalid parameters for API call'
};

// Update the content buffer handling
let contentBuffer = '';
const WORD_BOUNDARY_REGEX = /\b|\s+|[.,!?;:]|\n/;
const FORMAT_MARKERS = /^(Title:|•|-|\*)/;

function bufferAndCleanContent(content) {
  contentBuffer += content;
  
  // Look for complete lines and formatting markers
  const lines = contentBuffer.split('\n');
  
  // Keep the last line in buffer if it's incomplete
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

function cleanContent(content) {
  return content
    .replace(/\s+/g, ' ')                   // Normalize spaces to single space
}

// Update the message listener in background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveNote') {
    console.log('Received save note request:', request.note);
    
    // Create a promise to handle the async storage operation
    const saveNotePromise = new Promise((resolve, reject) => {
      // Validate the note data
      if (!request.note || !request.note.title || !request.note.content) {
        reject(new Error('Invalid note data'));
        return;
      }

      chrome.storage.local.get('savedNotes', (data) => {
        try {
          const savedNotes = data.savedNotes || [];
          savedNotes.push(request.note);
          
          chrome.storage.local.set({ savedNotes }, () => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    // Handle the promise and send response
    saveNotePromise
      .then(() => {
        console.log('Note saved successfully');
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Error saving note:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep the message channel open for async response
  }
});
