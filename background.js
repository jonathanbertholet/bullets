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
        console.log('Calling OpenAI API with streaming.');

        // Retrieve the API key from storage
        chrome.storage.sync.get('openaiApiKey', (data) => {
          const apiKey = data.openaiApiKey;
          if (apiKey) {
            callOpenAIStream(msg.text, apiKey, port);
          } else {
            console.error('No API key found.');
            port.postMessage({ type: 'error', error: 'No OpenAI API key found. Please set your API key in the extension settings.' });
          }
        });
      } else if (msg.action === 'generateTitle' && msg.summary) {
        console.log('Generating title from summary.');
        chrome.storage.sync.get('openaiApiKey', (data) => {
          const apiKey = data.openaiApiKey;
          if (apiKey) {
            generateTitle(msg.summary, apiKey, port);
          } else {
            console.error('No API key found.');
            port.postMessage({ type: 'error', error: 'No OpenAI API key found. Please set your API key in the extension settings.' });
          }
        });
      }
    });
  }
});

// Function to call OpenAI API with streaming
function callOpenAIStream(text, apiKey, port) {
  // Prepare the prompt
  const prompt = `your one and only goal is to summarize the following text into bullet points and bullet point indents ALWAYS use titles to categorize the bullet points so title then list of bullets then a line break then another title and so on DONT use markdown use • as bullet points ignore any items that might be menu elements footers related content author article title etc just focus on the content but avoid repetition of your output at all costs:\n\n${text}`;

  // Call the OpenAI API with streaming
  fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.7,
      stream: true
    })
  })
  .then(response => {
    if (!response.ok) {
      response.json().then(errorData => {
        port.postMessage({ type: 'error', error: errorData.error.message });
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
                port.postMessage({ type: 'data', content: content });
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
    console.error('Error calling OpenAI API:', error);
    port.postMessage({ type: 'error', error: error.toString() });
  });
}

// Function to generate title from summary
function generateTitle(summary, apiKey, port) {
  // Prepare the prompt
  const prompt = `i need a succint ten word title based on the following summary no quotes no markdown:\n\n${summary}`;

  // Call the OpenAI API
  fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 50,
      temperature: 0.7
    })
  })
  .then(response => response.json())
  .then(data => {
      if (data.error) {
          port.postMessage({ type: 'error', error: data.error.message });
      } else {
          const title = data.choices[0].message.content.trim();
          port.postMessage({ type: 'title', title: title });
      }
  })
  .catch(error => {
      console.error('Error calling OpenAI API:', error);
      port.postMessage({ type: 'error', error: error.toString() });
  });
}
