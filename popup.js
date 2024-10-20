// popup.js

document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const saveButton = document.getElementById('saveButton');
    const messageDiv = document.getElementById('message');
  
    // Load the saved API key from storage
    chrome.storage.sync.get('openaiApiKey', (data) => {
      if (data.openaiApiKey) {
        apiKeyInput.value = data.openaiApiKey;
      }
    });
  
    // Save the API key when the button is clicked
    saveButton.addEventListener('click', () => {
      const apiKey = apiKeyInput.value.trim();
      if (apiKey) {
        chrome.storage.sync.set({ openaiApiKey: apiKey }, () => {
          messageDiv.textContent = 'API Key saved successfully!';
          setTimeout(() => {
            messageDiv.textContent = '';
          }, 3000);
        });
      } else {
        messageDiv.textContent = 'Please enter a valid API Key.';
      }
    });
  });
  