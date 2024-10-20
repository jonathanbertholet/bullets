// background.js

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

// Listen for messages from content script to call OpenAI API
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received in background script:', request);
  if (request.action === 'callOpenAI' && request.text) {
    console.log('Calling OpenAI API.');

    // Retrieve the API key from storage
    chrome.storage.sync.get('openaiApiKey', (data) => {
      const apiKey = data.openaiApiKey;
      if (apiKey) {
        callOpenAI(request.text, apiKey)
          .then(summary => {
            console.log('OpenAI API response received.');
            sendResponse({ summary: summary });
          })
          .catch(error => {
            console.error('Error calling OpenAI API:', error);
            sendResponse({ error: error.toString() });
          });
      } else {
        console.error('No API key found.');
        sendResponse({ error: 'No OpenAI API key found. Please set your API key in the extension settings.' });
      }
    });
    return true; // Indicates that sendResponse will be called asynchronously
  }
});

// Function to call OpenAI API
function callOpenAI(text, apiKey) {
  // Prepare the prompt
  const prompt = `your one and only goal is to summarize the following text into bullet points and bullet point indents ALWAYS use titles to categorize the bullet points so title then list of bullets then a line break then another title and so on DONT use markdown ignore any items that might be menu elements footers related content author article title etc just focus on the content:\n\n${text}`;

  // Call the OpenAI API
  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.7
    })
  })
    .then(response => response.json())
    .then(data => {
      if (data.error) {
        throw new Error(data.error.message);
      }
      return data.choices[0].message.content.trim();
    });
}
