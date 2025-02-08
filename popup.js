document.addEventListener('DOMContentLoaded', function() {
  loadSavedNotes();
  
  const resetButton = document.getElementById('resetTime');
  if (resetButton) {
    resetButton.addEventListener('click', resetTimeSaved);
  }

  const searchBox = document.getElementById('searchNotes');
  if (searchBox) {
    searchBox.addEventListener('input', handleSearch);
  }

  // Add API key button listener
  const setApiKeyButton = document.getElementById('setApiKey');
  if (setApiKeyButton) {
    setApiKeyButton.addEventListener('click', handleSetApiKey);
  }

  // Check if API key exists and update button text
  chrome.storage.local.get(['customApiKey'], (data) => {
    if (data.customApiKey) {
      setApiKeyButton.textContent = 'Edit API Key';
    }
  });
});

function calculateTotalTimeSaved(generatedTime = 0) {
  return generatedTime.toFixed(1);
}

function loadSavedNotes() {
  const notesList = document.getElementById('notesList');
  const totalTimeSavedElement = document.getElementById('totalTimeSaved');
  
  chrome.storage.local.get(['savedNotes', 'generatedTimeSaved'], (data) => {
    const savedNotes = data.savedNotes || [];
    const generatedTime = data.generatedTimeSaved || 0;
    
    const totalTimeSaved = calculateTotalTimeSaved(generatedTime);
    totalTimeSavedElement.textContent = totalTimeSaved;
    
    if (savedNotes.length === 0) {
      notesList.innerHTML = '<p>No saved notes yet.</p>';
      return;
    }

    const linkSvg = `
        <svg class="icon link-note" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>`;

    notesList.innerHTML = savedNotes.map((note, index) => `
      <div class="note-item" data-index="${index}">
        <div class="note-header">
          <div class="note-title">${note.title}</div>
          <div class="icon-container">
            ${note.url ? linkSvg.replace('class="icon link-note"', `class="icon link-note" data-url="${note.url}" title="Open original page"`) : ''}
            <svg class="icon delete-note" data-index="${index}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </div>
        </div>
        <div class="note-date">${new Date(note.timestamp).toLocaleDateString()}</div>
        ${note.timeSaved ? `<div class="note-time-saved">Saved ${note.timeSaved} minutes</div>` : ''}
        <div class="note-summary" style="display: none;">${note.summary || ''}</div>
      </div>
    `).join('');

    notesList.querySelectorAll('.note-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('delete-note') && !e.target.classList.contains('link-note')) {
          const index = item.dataset.index;
          const note = savedNotes[index];
          
          const timeSavedText = note.timeSaved ? 
            `Saved ${note.timeSaved} minutes` : '';
          
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            const activeTab = tabs[0];
            
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['content.js']
            }).then(() => {
              setTimeout(() => {
                chrome.tabs.sendMessage(activeTab.id, {
                  action: 'showSavedNote',
                  note: {
                    ...note,
                    timeSavedText: timeSavedText,
                    url: note.url
                  }
                });
              }, 100);
            }).catch(err => {
              console.error('Error injecting content script:', err);
            });
          });
        }
      });
    });

    notesList.querySelectorAll('.delete-note').forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = button.dataset.index;
        savedNotes.splice(index, 1);
        
        chrome.storage.local.set({ savedNotes }, () => {
          loadSavedNotes();
        });
      });
    });

    notesList.querySelectorAll('.link-note').forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = link.dataset.url;
        chrome.tabs.create({ url: url });
      });
    });
  });
}

function resetTimeSaved() {
  if (confirm('Are you sure you want to reset the total time saved?')) {
    chrome.storage.local.set({
      generatedTimeSaved: 0
    }, () => {
      loadSavedNotes();
    });
  }
}

function handleSearch(e) {
  const searchTerm = e.target.value.toLowerCase();
  const noteItems = document.querySelectorAll('.note-item');
  
  chrome.storage.local.get(['savedNotes'], (data) => {
    const savedNotes = data.savedNotes || [];
    
    noteItems.forEach((item, index) => {
      const note = savedNotes[index];
      const searchableContent = `
        ${note.title || ''} 
        ${note.url || ''} 
        ${note.summary || ''} 
        ${note.content || ''}
      `.toLowerCase();
      
      if (searchableContent.includes(searchTerm)) {
        item.style.display = 'block';
      } else {
        item.style.display = 'none';
      }
    });
  });
}

function handleSetApiKey() {
  const container = document.querySelector('.api-key-container');
  const button = document.getElementById('setApiKey');
  const inputContainer = document.getElementById('apiKeyInput');
  const apiKeyField = document.getElementById('apiKeyField');
  const saveButton = document.getElementById('saveApiKey');

  // Show input field, hide button
  button.style.display = 'none';
  inputContainer.style.display = 'flex';
  
  // If there's an existing API key, show it in the input
  chrome.storage.local.get(['customApiKey'], (data) => {
    if (data.customApiKey) {
      apiKeyField.value = data.customApiKey;
    }
  });

  // Handle save button click
  saveButton.onclick = () => {
    const apiKey = apiKeyField.value.trim();
    if (apiKey) {
      chrome.storage.local.set({ customApiKey: apiKey }, () => {
        // Hide input, show button
        button.textContent = 'Edit API Key';
        button.style.display = 'block';
        inputContainer.style.display = 'none';
      });
    }
  };

  // Handle Enter key in input field
  apiKeyField.onkeypress = (e) => {
    if (e.key === 'Enter') {
      saveButton.click();
    }
  };
} 