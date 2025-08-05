console.log('Content script loaded.');

// Load CSS file
fetch(chrome.runtime.getURL('content.css'))
  .then(response => response.text())
  .then(css => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  })
  .catch(error => console.error('Error loading CSS:', error));

// ================= Global Variables =================
let popupElement = null;
let isPinned = false;
let cachedSummary = null;
let cachedTitle = null;
let cachedTimeSaved = null;

// Accumulators for streaming summary
let accumulatedContent = '';
let originalWordCount = 0;
let summaryWordCount = 0;

// Variables for drag functionality
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let popupStartRight = 0, popupStartBottom = 0;

// Variables for streamed text processing
let partialLine = '';
let textAccumulator = '';

// ================= Additional Variables and Helper Functions for Context =================

// New accumulators for context streaming
let accumulatedContext = '';
let contextPartialLine = '';
let contextTextAccumulator = '';

// Function to process streamed text for the context panel, similar to processStreamedText
function processStreamedContextText(text) {
  if (!contextTextAccumulator) contextTextAccumulator = '';
  let processedText = text;
  // Determine if a space is needed before appending new text
  const needsSpace = (
    contextTextAccumulator.length > 0 &&
    !contextTextAccumulator.endsWith(' ') &&
    !contextTextAccumulator.endsWith('\n') &&
    !processedText.startsWith(' ') &&
    !processedText.startsWith('\n') &&
    !processedText.startsWith('Title:') &&
    !processedText.match(/^[.,!?;:]/)
  );
  if (needsSpace) {
    processedText = ' ' + processedText;
  }
  contextTextAccumulator += processedText;
  contextTextAccumulator = contextTextAccumulator
    .replace(/\s+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n+/g, '\n')
    .replace(/([.,!?;:])(\w)/g, '$1 $2')
    .replace(/\*/g, '');
  return processedText;
}

//  Context panel
function updateContext(newText) {
  if (!popupElement) return;
  
  // Get the Context tab panel
  const contextPanel = popupElement.querySelector('.tab-panel.context');
  
  // Ensure a content wrapper exists for proper styling
  let contentWrapper = contextPanel.querySelector('.content');
  if (!contentWrapper) {
    contentWrapper = document.createElement('div');
    contentWrapper.className = 'content';
    contextPanel.appendChild(contentWrapper);
  }
  
  // Create a new span element for the streamed text with quick fade-in effect
  const span = document.createElement('span');
  span.style.opacity = '0';
  span.style.transition = 'opacity 0.1s ease-in-out'; // Quick fade-in transition (changed from 0.3s)
  span.style.display = 'block';
  
  // Process the incoming streamed text (handle partial lines similar to updatePopup)
  const textToProcess = processStreamedContextText(contextPartialLine + newText);
  contextPartialLine = '';
  const lines = textToProcess.split('\n');
  const lastLine = lines[lines.length - 1];
  if (lastLine && !lastLine.trim().endsWith('.')) {
    contextPartialLine = lines.pop() || '';
  }
  
  // Convert each complete line into HTML (using <li> for bullets and <h3> for titles)
  const processedHTML = lines.map(line => {
    line = line.trim().replace(/\s+/g, ' ');
    if (line.startsWith('Title:')) {
      return `<h3>${line.replace('Title:', '').trim()}</h3>`;
    } else {
      line = line.replace(/^[•\-\*]\s*/, '').trim();
      return line ? `<li>${line}</li>` : '';
    }
  }).filter(Boolean).join('');
  
  // Wrap bullet groups in <ul> tags for consistent styling
  const wrappedHTML = processedHTML.replace(/(<li>.*?<\/li>)+/g, match => `<ul>${match}</ul>`);
  span.innerHTML = wrappedHTML;
  
  // Append the new span to the content wrapper
  contentWrapper.appendChild(span);
  
  // Force reflow and trigger the quick fade-in effect
  void span.offsetWidth;
  requestAnimationFrame(() => {
    setTimeout(() => {
      span.style.opacity = '1';
    }, 10); // Reduced delay for quick fade-in (changed from 50ms)
  });
  
  // Append the new content to the overall accumulated content
  accumulatedContext += wrappedHTML;
}

// Start the API call to provide context when the Context tab is clicked
function fetchContext(text) {
  // Clear any previous content from the Context panel
  const contextPanel = popupElement.querySelector('.tab-panel.context');
  let contentWrapper = contextPanel.querySelector('.content');
  if (!contentWrapper) {
    contentWrapper = document.createElement('div');
    contentWrapper.className = 'content';
    contextPanel.appendChild(contentWrapper);
  } else {
    contentWrapper.innerHTML = '';
  }
  
  // Show a loading message
  contentWrapper.innerHTML = '<p>Computing context...</p>';
  
  // Reset context accumulators
  accumulatedContext = '';
  contextPartialLine = '';
  contextTextAccumulator = '';
  
  // Connect to the background script with the "openai" port
  const port = chrome.runtime.connect({ name: 'openai' });
  // Send the full page text as the source article to provide context for
  port.postMessage({ action: 'callOpenAIContext', text: text });
  
  // Listen for streamed response messages
  port.onMessage.addListener(function(msg) {
    if (msg.type === 'data') {
      updateContext(msg.content);
    } else if (msg.type === 'error') {
      console.error('Context API error:', msg.error);
      updateContext(`<p>Error: ${msg.error}</p>`);
      port.disconnect();
    } else if (msg.type === 'done') {
      port.disconnect();
    }
  });
}

// Document-level listeners tracker
const documentListeners = {
  onDocumentClick: null,
  onMouseMove: null,
  onMouseUp: null
};

// ================= Helper Functions =================

// Update the pin icon (accepts the element so we can update it immediately)
function updatePinIcon(pinIcon) {
  if (isPinned) {
    pinIcon.style.backgroundImage = `url(${chrome.runtime.getURL('icons/close.png')})`;
    pinIcon.title = 'Close';
  } else {
    pinIcon.style.backgroundImage = `url(${chrome.runtime.getURL('icons/pin.png')})`;
    pinIcon.title = 'Pin';
  }
}

// Setup copy button functionality (targeting the Summary tab content)
function setupCopyButton(copyButton, summaryPanel) {
  copyButton.addEventListener('click', () => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = summaryPanel.innerHTML;
    const plainText = tempDiv.innerText;
    
    const originalHTML = copyButton.innerHTML;
    // Fix width to avoid shifting during update
    copyButton.style.width = copyButton.offsetWidth + 'px';
    copyButton.innerHTML = `
         <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
           <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
         </svg>
    `;
    
    navigator.clipboard.writeText(plainText)
      .then(() => {
        setTimeout(() => {
          copyButton.innerHTML = originalHTML;
          copyButton.style.width = '';
        }, 2000);
      })
      .catch(() => {
        copyButton.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        `;
        setTimeout(() => {
          copyButton.innerHTML = originalHTML;
          copyButton.style.width = '';
        }, 2000);
      });
  });
}

// Update the "time saved" display inside the popup
function updateTimeSavedDisplay(timeSaved) {
  if (!popupElement) return;
  const timeSavedElement = popupElement.querySelector('.time-saved');
  if (timeSavedElement) {
    timeSavedElement.classList.add('updating');
    setTimeout(() => {
      timeSavedElement.textContent = `Saved ${timeSaved} minutes`;
      timeSavedElement.classList.remove('updating');
    }, 300);
  }
}

// ================= Popup Creation and Management =================

// Remove the popup and its associated listeners
function hidePopup() {
  if (popupElement) {
    if (documentListeners.onDocumentClick) {
      document.removeEventListener('mousedown', documentListeners.onDocumentClick);
      documentListeners.onDocumentClick = null;
    }
    if (documentListeners.onMouseMove) {
      document.removeEventListener('mousemove', documentListeners.onMouseMove);
      documentListeners.onMouseMove = null;
    }
    if (documentListeners.onMouseUp) {
      document.removeEventListener('mouseup', documentListeners.onMouseUp);
      documentListeners.onMouseUp = null;
    }
    popupElement.remove();
    popupElement = null;
    isDragging = false;
  }
}

// Create and show the popup with clear separation between title, content (with tabs), and actions
function showPopup(contentText = '', titleText = 'Bullets', timeSavedText = '', url = '') {
  console.log('Showing popup with params:', { contentText, titleText, timeSavedText, url });
  hidePopup(); // Clean up any existing popup
  
  popupElement = document.createElement('div');
  popupElement.className = 'bullets-ext-popup';
  // Default dimensions and positioning (adjust if needed)
  popupElement.style.width = '450px';
  popupElement.style.height = '550px';
  popupElement.style.position = 'fixed';
  popupElement.style.bottom = '25px';
  popupElement.style.right = '25px';
  
  // ---- Title Bar ----
  const titleDiv = document.createElement('div');
  titleDiv.className = 'popup-title';
  
  const iconImg = document.createElement('img');
  iconImg.src = chrome.runtime.getURL('icons/icon48.png');
  iconImg.className = 'popup-icon';
  titleDiv.appendChild(iconImg);
  
  const titleTextSpan = document.createElement('span');
  titleTextSpan.className = 'title-text';
  titleTextSpan.textContent = titleText;
  titleDiv.appendChild(titleTextSpan);
  
  const pinIcon = document.createElement('div');
  pinIcon.className = 'pin-icon';
  updatePinIcon(pinIcon);
  titleDiv.appendChild(pinIcon);
  
  // Toggle pin behavior
  pinIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isPinned) {
      isPinned = false;
      updatePinIcon(pinIcon);
      hidePopup();
    } else {
      isPinned = true;
      updatePinIcon(pinIcon);
    }
  });
  
  popupElement.appendChild(titleDiv);
  
  // ---- Content Section with Tabs ----
  const contentContainer = document.createElement('div');
  contentContainer.className = 'popup-content';
  
  // Tab header for switching between Summary and Context
  const tabHeader = document.createElement('div');
  tabHeader.className = 'tab-header';
  
  const summaryTabButton = document.createElement('button');
  summaryTabButton.className = 'tab-button active';
  summaryTabButton.textContent = 'Summary';
  summaryTabButton.dataset.tab = 'summary';
  
  const contextTabButton = document.createElement('button');
  contextTabButton.className = 'tab-button';
  contextTabButton.textContent = 'Context';
  contextTabButton.dataset.tab = 'context';
  
  tabHeader.appendChild(summaryTabButton);
  tabHeader.appendChild(contextTabButton);
  
  // Tab panels container
  const tabPanels = document.createElement('div');
  tabPanels.className = 'tab-panels';
  
  // Create the Summary tab panel
  const summaryPanel = document.createElement('div');
  summaryPanel.className = 'tab-panel summary active';
  const summaryContent = document.createElement('div');
  summaryContent.className = 'content'; // This container picks up your CSS stylings
  if (contentText) {
    summaryContent.innerHTML = contentText;
    summaryContent.style.opacity = 1;
  }
  summaryPanel.appendChild(summaryContent);
  
  // Create the Context tab panel (initially empty)
  const contextPanel = document.createElement('div');
  contextPanel.className = 'tab-panel context';
  
  tabPanels.appendChild(summaryPanel);
  tabPanels.appendChild(contextPanel);
  
  contentContainer.appendChild(tabHeader);
  contentContainer.appendChild(tabPanels);
  popupElement.appendChild(contentContainer);
  
  // Setup tab switching behavior (modified to trigger context API call)
  [summaryTabButton, contextTabButton].forEach(button => {
    button.addEventListener('click', () => {
      // Remove the active class from all tab buttons and panels
      tabHeader.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
      tabPanels.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
      
      // Activate the clicked tab and its corresponding panel
      button.classList.add('active');
      const tab = button.dataset.tab;
      const activePanel = tabPanels.querySelector(`.tab-panel.${tab}`);
      if (activePanel) activePanel.classList.add('active');
      
      // When the Context tab is clicked for the first time, trigger the API call
      if (tab === 'context' && !activePanel.dataset.loaded) {
        activePanel.dataset.loaded = 'true'; // flag so we do not duplicate the call
        const pageText = getCleanedPageText(); // Use the full page text as the source article
        fetchContext(pageText);
      }
    });
  });
  
  // ---- Actions Section ----
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'popup-actions';
  
  // Copy button (copies content of Summary tab)
  const copyButton = document.createElement('button');
  copyButton.className = 'copy-button';
  copyButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
      </svg>
  `;
  actionsDiv.appendChild(copyButton);
  setupCopyButton(copyButton, summaryPanel);
  
  // Open original (link) button
  const linkButton = document.createElement('button');
  linkButton.textContent = 'Open Original';
  linkButton.className = 'link-button';
  if (url) {
    linkButton.addEventListener('click', () => window.open(url, '_blank'));
  } else {
    linkButton.style.display = 'none';
  }
  actionsDiv.appendChild(linkButton);
  
  // Save button (only for new summaries)
  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save';
  saveButton.className = 'save-button';
  if (contentText) {
    saveButton.style.display = 'none';
  }
  saveButton.addEventListener('click', () => {
    const noteData = {
      title: cachedTitle || titleText,
      content: summaryPanel.innerHTML,
      timestamp: new Date().toISOString(),
      timeSaved: cachedTimeSaved ? parseFloat(cachedTimeSaved.match(/\d+\.?\d*/)[0]) : null,
      url: window.location.href
    };
    
    console.log('Saving note:', noteData);
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    
    if (noteData.timeSaved) {
      chrome.storage.local.get('generatedTimeSaved', (data) => {
        const currentTotal = parseFloat(data.generatedTimeSaved || 0);
        const newTotal = Math.max(0, currentTotal - noteData.timeSaved);
        chrome.storage.local.set({ generatedTimeSaved: newTotal });
      });
    }
    
    chrome.runtime.sendMessage({ action: 'saveNote', note: noteData }, (response) => {
      saveButton.disabled = false;
      if (response && response.success) {
        saveButton.textContent = 'Saved';
        setTimeout(() => (saveButton.textContent = 'Save'), 2000);
      } else {
        console.error('Error saving note:', response?.error || 'Failed to save note');
        saveButton.textContent = 'Error!';
        setTimeout(() => (saveButton.textContent = 'Save'), 2000);
      }
    });
  });
  actionsDiv.appendChild(saveButton);
  
  // Time saved display
  const timeSavedElement = document.createElement('div');
  timeSavedElement.className = 'time-saved';
  if (timeSavedText) {
    const timeValue = parseFloat(timeSavedText);
    timeSavedElement.textContent = !isNaN(timeValue)
      ? `Saved ${timeValue} minutes`
      : timeSavedText;
  } else if (!contentText) {
    timeSavedElement.textContent = 'Computing time saved...';
  }
  actionsDiv.appendChild(timeSavedElement);
  
  popupElement.appendChild(actionsDiv);
  
  // ---- Resize Handles ----
  const resizeHandleLeft = document.createElement('div');
  resizeHandleLeft.className = 'resize-handle-left';
  popupElement.appendChild(resizeHandleLeft);
  
  const resizeHandleTop = document.createElement('div');
  resizeHandleTop.className = 'resize-handle-top';
  popupElement.appendChild(resizeHandleTop);
  
  const resizeHandleCorner = document.createElement('div');
  resizeHandleCorner.className = 'resize-handle-corner';
  popupElement.appendChild(resizeHandleCorner);
  
  // ---- Resize Functionality ----
  let isResizing = false;
  let currentHandle = null;
  let startWidth, startHeight, startX, startY, startLeft;
  
  const startResize = (e, handle) => {
    isResizing = true;
    currentHandle = handle;
    const rect = popupElement.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
    popupElement.classList.add('resizing');
    e.preventDefault();
  };
  
  const handleResize = (e) => {
    if (!isResizing) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const styles = getComputedStyle(popupElement);
    const minWidth = parseInt(styles.getPropertyValue('--min-width')) || 200;
    const maxWidth = parseInt(styles.getPropertyValue('--max-width')) || window.innerWidth;
    const minHeight = parseInt(styles.getPropertyValue('--min-height')) || 100;
    const maxHeight = parseInt(styles.getPropertyValue('--max-height')) || window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    switch (currentHandle) {
      case 'left': {
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth - deltaX));
        popupElement.style.width = `${newWidth}px`;
        popupElement.style.right = `${viewportWidth - (startLeft + startWidth)}px`;
        popupElement.style.left = '';
        break;
      }
      case 'top': {
        const newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight - deltaY));
        popupElement.style.height = `${newHeight}px`;
        break;
      }
      case 'corner': {
        const cornerWidth = Math.min(maxWidth, Math.max(minWidth, startWidth - deltaX));
        const cornerHeight = Math.min(maxHeight, Math.max(minHeight, startHeight - deltaY));
        popupElement.style.width = `${cornerWidth}px`;
        popupElement.style.height = `${cornerHeight}px`;
        popupElement.style.right = `${viewportWidth - (startLeft + startWidth)}px`;
        popupElement.style.left = '';
        break;
      }
    }
  };
  
  const stopResize = () => {
    isResizing = false;
    currentHandle = null;
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
    popupElement.classList.remove('resizing');
    savePopupPreferences();
  };
  
  resizeHandleLeft.addEventListener('mousedown', (e) => startResize(e, 'left'));
  resizeHandleTop.addEventListener('mousedown', (e) => startResize(e, 'top'));
  resizeHandleCorner.addEventListener('mousedown', (e) => startResize(e, 'corner'));
  
  // ---- Drag Functionality ----
  titleDiv.addEventListener('mousedown', (e) => {
    if (e.target === pinIcon) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = popupElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    popupStartRight = viewportWidth - rect.right;
    popupStartBottom = viewportHeight - rect.bottom;
    e.preventDefault();
  });
  
  const onMouseMove = (e) => {
    if (isDragging) {
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      const newRight = popupStartRight - deltaX;
      const newBottom = popupStartBottom - deltaY;
      popupElement.style.right = `${newRight}px`;
      popupElement.style.bottom = `${newBottom}px`;
      popupElement.style.left = '';
      popupElement.style.top = '';
    }
  };
  
  const onMouseUp = () => {
    if (isDragging) { isDragging = false; }
  };
  
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  documentListeners.onMouseMove = onMouseMove;
  documentListeners.onMouseUp = onMouseUp;
  
  // Close the popup if clicking outside it (unless pinned)
  const onDocumentClick = (event) => {
    if (popupElement.contains(event.target) || isDragging) return;
    if (!isPinned) {
      hidePopup();
    }
  };
  document.addEventListener('mousedown', onDocumentClick);
  documentListeners.onDocumentClick = onDocumentClick;
  
  // ---- Popup Preferences (Save & Load) ----
  function savePopupPreferences() {
    const rect = popupElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const prefs = {
      position: {
        right: viewportWidth - rect.right,
        bottom: viewportHeight - rect.bottom
      },
      size: {
        width: rect.width,
        height: rect.height
      }
    };
    chrome.storage.local.set({ popupPrefs: prefs });
  }
  
  function loadPopupPreferences() {
    chrome.storage.local.get('popupPrefs', (data) => {
      if (data.popupPrefs) {
        popupElement.style.width = `${data.popupPrefs.size.width}px`;
        popupElement.style.height = `${data.popupPrefs.size.height}px`;
        if (data.popupPrefs.position.right !== undefined) {
          popupElement.style.right = `${data.popupPrefs.position.right}px`;
          popupElement.style.bottom = `${data.popupPrefs.position.bottom}px`;
          popupElement.style.left = '';
          popupElement.style.top = '';
        } else {
          popupElement.style.right = '20px';
          popupElement.style.bottom = '20px';
        }
      }
    });
  }
  
  loadPopupPreferences();
  document.body.appendChild(popupElement);
  
  return popupElement;
}

// ================= Text Summarization =================

function getCleanedPageText() {
  const clonedBody = document.body.cloneNode(true);
  const unwantedSelectors = 'header, nav, footer, aside, script, style, noscript';
  clonedBody.querySelectorAll(unwantedSelectors).forEach(el => el.remove());
  return clonedBody.innerText.trim();
}

function countWords(text) {
  const cleanText = text.replace(/<[^>]*>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
  return cleanText ? cleanText.split(' ').length : 0;
}

function calculateTimeSaved(originalWords, summaryWords, wpm = 250) {
  console.log(`Original words: ${originalWords}, Summary words: ${summaryWords}`);
  const originalReadingTime = originalWords / wpm;
  const summaryReadingTime = summaryWords / wpm;
  const timeSaved = originalReadingTime - summaryReadingTime;
  console.log(`Time saved: ${timeSaved} minutes`);
  return Math.max(0, timeSaved).toFixed(1);
}

function summarizeText(text) {
  console.log('Summarize text called.');
  showPopup('', 'Bullets', 'Computing time saved...');
  
  resetTextAccumulator();
  accumulatedContent = '';
  originalWordCount = countWords(text);
  summaryWordCount = 0;
  console.log(`Original text word count: ${originalWordCount}`);
  
  const port = chrome.runtime.connect({ name: 'openai' });
  port.postMessage({ action: 'callOpenAI', text: text });
  
  port.onMessage.addListener(function(msg) {
    if (msg.type === 'data') {
      updatePopup(msg.content);
    } else if (msg.type === 'error') {
      console.error(msg.error);
      showPopup(`Error: ${msg.error}`, 'Error');
    } else if (msg.type === 'done') {
      summaryWordCount = countWords(accumulatedContent);
      const timeSaved = calculateTimeSaved(originalWordCount, summaryWordCount);
      updateTimeSavedDisplay(timeSaved);
      cachedTimeSaved = timeSaved;
      chrome.storage.local.get('generatedTimeSaved', (data) => {
        const currentTotal = parseFloat(data.generatedTimeSaved || 0);
        const newTotal = currentTotal + parseFloat(timeSaved);
        console.log('Updating generated time saved:', { currentTotal, newTime: timeSaved, newTotal });
        chrome.storage.local.set({ generatedTimeSaved: newTotal });
      });
      generateTitle(accumulatedContent);
      port.disconnect();
    }
  });
}

function generateTitle(summary) {
  console.log('Generating title for summary:', summary.substring(0, 100) + '...');
  const port = chrome.runtime.connect({ name: 'openai' });
  port.postMessage({ action: 'generateTitle', summary: summary });
  
  port.onMessage.addListener(function(msg) {
    console.log('Received title response:', msg);
    if (msg.type === 'title') {
      if (popupElement) {
        const titleTextSpan = popupElement.querySelector('.popup-title .title-text');
        titleTextSpan.style.opacity = 0;
        setTimeout(() => {
          const title = msg.title.trim();
          console.log('Setting title to:', title);
          titleTextSpan.textContent = title;
          titleTextSpan.style.opacity = 1;
        }, 500);
      }
      cachedTitle = msg.title;
      cachedSummary = accumulatedContent;
      port.disconnect();
    } else if (msg.type === 'error') {
      console.error('Title generation error:', msg.error);
      if (popupElement) {
        const titleTextSpan = popupElement.querySelector('.popup-title .title-text');
        titleTextSpan.textContent = 'Summary';
      }
      port.disconnect();
    }
  });
}

// ------------------------------
// Modified updatePopup to use processStreamedGeneric for the Summary panel
// ------------------------------
function updatePopup(newText) {
  if (!popupElement) return;
  
  // Get the Summary panel
  const summaryPanel = popupElement.querySelector('.tab-panel.summary');
  
  // Ensure a content wrapper exists for proper styling
  let contentWrapper = summaryPanel.querySelector('.content');
  if (!contentWrapper) {
    contentWrapper = document.createElement('div');
    contentWrapper.className = 'content';
    summaryPanel.appendChild(contentWrapper);
  }
  
  // Create a new span element for the streamed text with a quick fade-in effect on the container itself
  const span = document.createElement('span');
  span.style.opacity = '0';
  span.style.transition = 'opacity 0.1s ease-in-out'; // Quick fade-in for the container
  span.style.display = 'block';
  
  // Use the generic function for the summary panel.
  // Combine any previously incomplete text (partialLine) with the new text.
  const textToProcess = processStreamedGeneric(partialLine + newText, 'summary');
  // Reset the partialLine after processing.
  partialLine = '';
  
  // Manage incomplete lines: if the last line isn't complete, save it for later
  const lines = textToProcess.split('\n');
  const lastLine = lines[lines.length - 1];
  if (lastLine && !lastLine.trim().endsWith('.')) {
    partialLine = lines.pop() || '';
  }
  
  // Convert each complete line into HTML (using <li> for bullets and <h3> for titles)
  const processedHTML = lines.map(line => {
    line = line.trim().replace(/\s+/g, ' ');
    if (line.startsWith('Title:')) {
      return `<h3>${line.replace('Title:', '').trim()}</h3>`;
    } else {
      line = line.replace(/^[•\-\*]\s*/, '').trim();
      return line ? `<li>${line}</li>` : '';
    }
  }).filter(Boolean).join('');
  
  // Wrap bullet groups in <ul> tags for consistent styling
  const wrappedHTML = processedHTML.replace(/(<li>.*?<\/li>)+/g, match => `<ul>${match}</ul>`);
  span.innerHTML = wrappedHTML;
  
  // Append the new span to the content wrapper
  contentWrapper.appendChild(span);
  
  // Force reflow and trigger the fade-in for the span container
  void span.offsetWidth;
  requestAnimationFrame(() => {
    setTimeout(() => { span.style.opacity = '1'; }, 10); // Slight delay to trigger the transition
  });
  
  // Now, add the "fade-in" class to each <li> to trigger the CSS animation
  const liElements = span.querySelectorAll('li');
  liElements.forEach(li => {
    li.classList.add('fade-in'); // This class should trigger the CSS animation
  });
  
  // Append the new content to the overall accumulated content
  accumulatedContent += wrappedHTML;
}

// ------------------------------
// Generic function to process streamed text
// ------------------------------
// This function fuses the logic for processing streamed text for both the Summary
// and Context panels. It uses either the global variable `textAccumulator` (for summary)
// or `contextTextAccumulator` (for context) based on the provided panel type.
function processStreamedGeneric(text, panelType) {
  // Select the correct accumulator based on panel type.
  // If the accumulator is not yet defined, initialize it as an empty string.
  let accumulator;
  if (panelType === 'context') {
    accumulator = (typeof contextTextAccumulator !== 'undefined') ? contextTextAccumulator : '';
  } else {
    accumulator = (typeof textAccumulator !== 'undefined') ? textAccumulator : '';
  }

  let processedText = text;
  // Determine if a space should be inserted before new text.
  const needsSpace = (
    accumulator.length > 0 &&
    !accumulator.endsWith(' ') &&
    !accumulator.endsWith('\n') &&
    !processedText.startsWith(' ') &&
    !processedText.startsWith('\n') &&
    !processedText.startsWith('Title:') &&
    !processedText.match(/^[.,!?;:]/)
  );
  if (needsSpace) {
    processedText = ' ' + processedText;
  }

  // Append processed text to the accumulator
  accumulator += processedText;
  // Clean up: normalize spaces, newlines, punctuation spacing, and asterisks
  accumulator = accumulator
    .replace(/\s+/g, ' ')           // Normalize multiple spaces to single space
    .replace(/\s+\n/g, '\n')        // Remove spaces before newlines
    .replace(/\n\s+/g, '\n')        // Remove spaces after newlines  
    .replace(/\n+/g, '\n')          // Normalize multiple newlines
    .replace(/([.,!?;:])(\w)/g, '$1 $2')  // Add space after punctuation
    .replace(/\*+/g, '');           // Remove asterisks

  // Update the appropriate global variable with the new accumulator value.
  if (panelType === 'context') {
    contextTextAccumulator = accumulator;
  } else {
    textAccumulator = accumulator;
  }

  return processedText;
}

function resetTextAccumulator() {
  textAccumulator = '';
}

// ================= Message Listener =================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  if (request.action === 'summarizePage') {
    console.log('Starting page summarization');
    if (cachedSummary) {
      console.log('Using cached summary');
      showPopup(cachedSummary, cachedTitle, cachedTimeSaved);
    } else {
      const pageText = getCleanedPageText();
      console.log('Page text length:', pageText.length);
      originalWordCount = countWords(pageText);
      console.log('Original word count:', originalWordCount);
      summarizeText(pageText);
    }
  } else if (request.action === 'summarizeSelection') {
    console.log('Starting selection summarization');
    if (cachedSummary) {
      console.log('Using cached summary');
      showPopup(cachedSummary, cachedTitle, cachedTimeSaved);
    } else {
      const selectedText = window.getSelection().toString();
      console.log('Selected text length:', selectedText.length);
      originalWordCount = countWords(selectedText);
      console.log('Original word count:', originalWordCount);
      summarizeText(selectedText);
    }
  } else if (request.action === 'showSavedNote') {
    showPopup(request.note.content, request.note.title, request.note.timeSavedText, request.note.url);
    sendResponse({ success: true });
    return true;
  }
});
