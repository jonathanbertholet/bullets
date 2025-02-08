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

let popupElement = null;
let isPinned = false;
let cachedSummary = null;
let cachedTitle = null;
let cachedTimeSaved = null;

// Variable to accumulate the streaming content
let accumulatedContent = '';

// Variables for word counts
let originalWordCount = 0;
let summaryWordCount = 0;

// Variables for drag functionality
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let popupStartX = 0;
let popupStartY = 0;

// Add this at the top with other global variables
let partialLine = '';
let textAccumulator = '';

// Track our document-level listeners
const documentListeners = {
  onDocumentClick: null,
  onMouseMove: null,
  onMouseUp: null
};

// Add this new function to hide the popup
function hidePopup() {
  if (popupElement) {
    // 1. Remove document-level event listeners if they exist
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

    // 2. Remove the popup element
    popupElement.remove();
    popupElement = null;
    
    // 3. Reset drag state
    isDragging = false;
  }
}

// Merge the two showPopup functions into one comprehensive version
function showPopup(contentText = '', titleText = 'Bullets', timeSavedText = '', url = '') {
  console.log('Showing popup with params:', { contentText, titleText, timeSavedText, url });
  
  // Clean up any existing popup first
  hidePopup();
  
  // Create popup element with default styles
  popupElement = document.createElement('div');
  popupElement.className = 'bullets-ext-popup';
  
  // Set default dimensions and positioning
  popupElement.style.width = '4450px';
  popupElement.style.height = '550px';
  popupElement.style.position = 'fixed';
  popupElement.style.bottom = '25px';
  popupElement.style.right = '25px';
  
  // Create title div
  const titleDiv = document.createElement('div');
  titleDiv.className = 'popup-title';
  
  // Create image element for the icon
  const iconImg = document.createElement('img');
  iconImg.src = chrome.runtime.getURL('icons/icon48.png');
  iconImg.className = 'popup-icon';
  titleDiv.appendChild(iconImg);
  
  // Create span for the title text
  const titleTextSpan = document.createElement('span');
  titleTextSpan.className = 'title-text';
  titleTextSpan.textContent = titleText;
  titleDiv.appendChild(titleTextSpan);
  
  // Create pin icon element
  const pinIcon = document.createElement('div');
  pinIcon.className = 'pin-icon';
  updatePinIcon();
  titleDiv.appendChild(pinIcon);
  
  popupElement.appendChild(titleDiv);
  
  // Create content container
  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';
  
  // If contentText is provided, populate it
  if (contentText) {
    const span = document.createElement('span');
    span.innerHTML = contentText;
    span.style.opacity = 1;
    contentDiv.appendChild(span);
  }
  
  popupElement.appendChild(contentDiv);
  
  // Create actions section
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'popup-actions';
  
  // Create copy button
  const copyButton = document.createElement('button');
  copyButton.className = 'copy-button';
  copyButton.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
    </svg>
  `;
  actionsDiv.appendChild(copyButton);
  
  // Conditionally include the save button
  const saveButton = document.createElement('button');
  saveButton.className = 'save-button';
  saveButton.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
    </svg>
  `;
  
  // Only show the save button when contentText is empty
  if (!contentText) {
    actionsDiv.appendChild(saveButton);
    setupSaveButton(saveButton, contentDiv);
  }
  
  // Create the new share button
  const shareButton = document.createElement('button');
  shareButton.className = 'share-button';
  shareButton.textContent = 'Share';
  actionsDiv.appendChild(shareButton);
  
  // Append time saved element
  const timeSavedElement = document.createElement('div');
  timeSavedElement.className = 'time-saved';
  timeSavedElement.textContent = timeSavedText || '';
  actionsDiv.appendChild(timeSavedElement);
  
  popupElement.appendChild(actionsDiv);
  
  // Append the popup to the body
  document.body.appendChild(popupElement);
  
  // Setup event listeners for buttons
  setupCopyButton(copyButton, contentDiv);
  setupShareButton(shareButton, contentDiv);
  
  // ... rest of your setup code ...
}

// Helper functions (move these outside showPopup)
function updatePinIcon() {
  const pinIcon = popupElement.querySelector('.pin-icon');
  if (isPinned) {
    pinIcon.style.backgroundImage = `url(${chrome.runtime.getURL('icons/close.png')})`;
    pinIcon.title = 'Close';
  } else {
    pinIcon.style.backgroundImage = `url(${chrome.runtime.getURL('icons/pin.png')})`;
    pinIcon.title = 'Pin';
  }
}

function setupCopyButton(copyButton, contentDiv) {
  copyButton.addEventListener('click', () => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = contentDiv.innerHTML;
    const plainText = tempDiv.innerText;
    
    const originalHTML = copyButton.innerHTML;
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

function setupShareButton(shareButton, contentDiv) {
  shareButton.addEventListener('click', () => {
    // Implement the share functionality
    console.log('Share button clicked');
    // Your share logic here
  });
}

// ... (continue with other helper functions) ...

// Update the onDocumentClick function
function onDocumentClick(event) {
  if (popupElement.contains(event.target) || isDragging) {
    return;
  }
  if (!isPinned) {
    hidePopup();  // Use hidePopup instead of direct removal
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  if (request.action === 'summarizePage') {
    console.log('Starting page summarization');
    if (cachedSummary) {
      console.log('Using cached summary');
      showPopup(cachedSummary, cachedTitle, cachedTimeSaved);
    } else {
      let pageText = getCleanedPageText();
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
      let selectedText = window.getSelection().toString();
      console.log('Selected text length:', selectedText.length);
      originalWordCount = countWords(selectedText);
      console.log('Original word count:', originalWordCount);
      summarizeText(selectedText);
    }
  } else if (request.action === 'showSavedNote') {
    showPopup(request.note.content, request.note.title, '', request.note.url);
  }
});

// Function to get the cleaned page text
function getCleanedPageText() {
  // Clone the body to avoid modifying the actual page
  const clonedBody = document.body.cloneNode(true);

  // List of selectors to remove
  const unwantedSelectors = 'header, nav, footer, aside, script, style, noscript';

  // Remove unwanted elements from cloned body
  clonedBody.querySelectorAll(unwantedSelectors).forEach(el => el.remove());

  // Get the text content
  return clonedBody.innerText.trim();
}

// Function to count words in a text
function countWords(text) {
  // Remove HTML tags and clean up whitespace
  const cleanText = text.replace(/<[^>]*>/g, ' ')
                       .replace(/\s+/g, ' ')
                       .trim();
  return cleanText.split(' ').length;
}

// Function to calculate time saved
function calculateTimeSaved(originalWords, summaryWords, wpm = 250) {
  console.log(`Original words: ${originalWords}, Summary words: ${summaryWords}`);
  const originalReadingTime = originalWords / wpm;
  const summaryReadingTime = summaryWords / wpm;
  const timeSaved = originalReadingTime - summaryReadingTime;
  console.log(`Time saved: ${timeSaved} minutes`);
  return Math.max(0, timeSaved).toFixed(1);
}

// Function to summarize text
function summarizeText(text) {
  console.log('Summarize text called.');
  showPopup('', 'Bullets', 'Computing time saved...');
  
  // Reset accumulators
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

      // Store the final generated time in Chrome storage
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

// Function to generate title using AI
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

// Function to update the popup with streaming data
function updatePopup(newText) {
  if (!popupElement) return;
  
  const contentDiv = popupElement.querySelector('.content');
  
  // Create a new span for this chunk
  const span = document.createElement('span');
  
  // Process the text
  const textToProcess = processStreamedText(partialLine + newText);
  partialLine = '';  // Reset partial line
  
  // Split into lines and process each
  const lines = textToProcess.split('\n');
  
  // Check if the last line is complete
  const lastLine = lines[lines.length - 1];
  if (lastLine && !lastLine.trim().endsWith('.')) {
    partialLine = lines.pop() || '';
  }
  
  // Process complete lines into HTML
  const processedHTML = lines.map(line => {
    line = line.trim();
    if (!line) return '';
    
    // Clean up the line
    line = line
      .replace(/\s+/g, ' ')  // Normalize spaces
      .trim();
    
    if (line.startsWith('Title:')) {
      return `<h3>${line.replace('Title:', '').trim()}</h3>`;
    } else {
      // Treat any non-empty line as a bullet point if it's not a title
      line = line.replace(/^[•\-\*]\s*/, '').trim();
      return line ? `<li>${line}</li>` : '';
    }
  }).filter(Boolean).join('');
  
  // If we have list items, wrap them in a ul
  const wrappedHTML = processedHTML.replace(
    /(<li>.*?<\/li>)+/g, 
    match => `<ul>${match}</ul>`
  );
  
  span.innerHTML = wrappedHTML;
  contentDiv.appendChild(span);
  
  requestAnimationFrame(() => {
    span.style.opacity = 1;
  });
  
  accumulatedContent += wrappedHTML;
  
  // Update summary word count after each chunk
  summaryWordCount = countWords(accumulatedContent);
  
  // Calculate and update time saved if we have both counts
  if (originalWordCount > 0) {
    const timeSaved = calculateTimeSaved(originalWordCount, summaryWordCount);
    updateTimeSavedDisplay(timeSaved);
  }
}

// New helper function to process streamed text
function processStreamedText(text) {
  // If this is the first chunk, initialize the accumulator
  if (!textAccumulator) {
    textAccumulator = '';
  }

  // Clean up the incoming text
  let processedText = text
    // Fix common stuck-together patterns


  // Check if we need to add a space between tokens
  const needsSpace = (
    textAccumulator.length > 0 && 
    !textAccumulator.endsWith(' ') && 
    !textAccumulator.endsWith('\n') &&
    !processedText.startsWith(' ') &&
    !processedText.startsWith('\n') &&
    !processedText.startsWith('Title:') &&
    !processedText.match(/^[.,!?;:]/) // Don't add space before punctuation
  );

  // Add space if needed and update accumulator
  if (needsSpace) {
    processedText = ' ' + processedText;
  }
  
  textAccumulator += processedText;

  // Clean up the accumulated text
  textAccumulator = textAccumulator
    .replace(/\s+/g, ' ')        // Normalize multiple spaces to single space
    .replace(/\s+\n/g, '\n')     // Remove spaces before newlines
    .replace(/\n\s+/g, '\n')     // Remove spaces after newlines
    .replace(/\n+/g, '\n')       // Normalize multiple newlines
    .replace(/([.,!?;:])(\w)/g, '$1 $2'); // Add space after punctuation

  return processedText;
}

// Reset accumulator when starting a new summary
function resetTextAccumulator() {
  textAccumulator = '';
}

// Function to update the time saved display
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

// Function to show popup
function showPopup(contentText = '', titleText = 'Bullets', timeSavedText = '', url = '') {
  console.log('Showing popup.');
  // Remove existing popup if any
  if (popupElement) {
    popupElement.remove();
  }

  // Create popup element
  popupElement = document.createElement('div');
  popupElement.className = 'bullets-ext-popup';

  // Create title div
  const titleDiv = document.createElement('div');
  titleDiv.className = 'popup-title';

  // Create image element for the icon
  const iconImg = document.createElement('img');
  iconImg.src = chrome.runtime.getURL('icons/icon48.png');
  iconImg.className = 'popup-icon';
  titleDiv.appendChild(iconImg);

  // Create span for the title text
  const titleTextSpan = document.createElement('span');
  titleTextSpan.className = 'title-text';
  titleTextSpan.textContent = titleText;
  titleDiv.appendChild(titleTextSpan);

  // Create pin icon element
  const pinIcon = document.createElement('div');
  pinIcon.className = 'pin-icon';
  updatePinIcon();
  titleDiv.appendChild(pinIcon);

  pinIcon.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent event from bubbling
    if (isPinned) {
      // Unpin and close the popup
      isPinned = false;
      updatePinIcon();
      popupElement.remove();
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    } else {
      // Pin the popup
      isPinned = true;
      updatePinIcon();
    }
  });

  function updatePinIcon() {
    if (isPinned) {
      // Show close icon
      pinIcon.style.backgroundImage = `url(${chrome.runtime.getURL('icons/close.png')})`;
      pinIcon.title = 'Close';
    } else {
      // Show pin icon
      pinIcon.style.backgroundImage = `url(${chrome.runtime.getURL('icons/pin.png')})`;
      pinIcon.title = 'Pin';
    }
  }

  popupElement.appendChild(titleDiv);

  // Create content container
  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';

  // If contentText is provided (from cache), populate it
  if (contentText) {
    const span = document.createElement('span');
    span.innerHTML = contentText;
    span.style.opacity = 1; // Set opacity to 1 since it's already loaded
    contentDiv.appendChild(span);
  }

  // Append contentDiv to popup
  popupElement.appendChild(contentDiv);

  // Add the actions section with "Copy" button and time saved
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'popup-actions';

  const copyButton = document.createElement('button');
  copyButton.textContent = 'Copy';
  copyButton.className = 'copy-button';

  // Create link button (new)
  const linkButton = document.createElement('button');
  linkButton.textContent = 'Open Original';
  linkButton.className = 'copy-button link-button';
  
  // Only show and enable link button if URL is provided
  if (url) {
    linkButton.addEventListener('click', () => {
      // Open in new tab
      window.open(url, '_blank');
    });
  } else {
    linkButton.style.display = 'none';
  }

  // Create save button
  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save';
  saveButton.className = 'copy-button save-button';
  
  // Only show save button for new summaries (when contentText is empty)
  if (contentText) {
    saveButton.style.display = 'none';
  }
  
  saveButton.addEventListener('click', () => {
    const noteData = {
      title: cachedTitle || titleText,
      content: contentDiv.innerHTML,
      timestamp: new Date().toISOString(),
      timeSaved: cachedTimeSaved ? parseFloat(cachedTimeSaved.match(/\d+\.?\d*/)[0]) : null,
      url: window.location.href
    };
    
    console.log('Saving note:', noteData);
    
    // Disable the button while saving
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    
    // Subtract the time from generatedTimeSaved when saving a note
    if (noteData.timeSaved) {
      chrome.storage.local.get('generatedTimeSaved', (data) => {
        const currentTotal = parseFloat(data.generatedTimeSaved || 0);
        const newTotal = Math.max(0, currentTotal - noteData.timeSaved);
        chrome.storage.local.set({ generatedTimeSaved: newTotal });
      });
    }
    
    chrome.runtime.sendMessage({
      action: 'saveNote',
      note: noteData
    }, (response) => {
      saveButton.disabled = false;
      
      if (response && response.success) {
        saveButton.textContent = 'Saved';
        setTimeout(() => {
          saveButton.textContent = 'Save';
        }, 2000);
      } else {
        const errorMsg = response?.error || 'Failed to save note';
        console.error('Error saving note:', errorMsg);
        saveButton.textContent = 'Error!';
        setTimeout(() => {
          saveButton.textContent = 'Save';
        }, 2000);
      }
    });
  });

  copyButton.addEventListener('click', () => {
    // Create a temporary element to handle HTML content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = contentDiv.innerHTML;
    
    // Convert HTML to plain text while preserving structure
    const plainText = tempDiv.innerText;
    
    navigator.clipboard.writeText(plainText).then(() => {
      copyButton.textContent = 'Copied!';
      setTimeout(() => {
        copyButton.textContent = 'Copy';
      }, 2000);
    }).catch(err => {
      console.error('Could not copy text: ', err);
    });
  });

  // Create time saved element
  const timeSavedElement = document.createElement('div');
  timeSavedElement.className = 'time-saved';
  
  // Format time saved text consistently
  if (timeSavedText) {
    // Check if timeSavedText is just a number or already formatted
    const timeValue = parseFloat(timeSavedText);
    if (!isNaN(timeValue)) {
      // If it's just a number, format it consistently
      timeSavedElement.textContent = `Saved ${timeValue} minutes`;
    } else {
      // If it's already formatted, use as is
      timeSavedElement.textContent = timeSavedText;
    }
  } else if (!contentText) {
    // Computing message for new summaries
    timeSavedElement.textContent = 'Computing time saved...';
  } else {
    // Empty for other cases
    timeSavedElement.textContent = '';
  }

  // Append buttons and timeSavedElement to actionsDiv
  actionsDiv.appendChild(copyButton);
  actionsDiv.appendChild(linkButton);  // Add link button after copy button
  actionsDiv.appendChild(saveButton);
  actionsDiv.appendChild(timeSavedElement);

  // Append actionsDiv to popupElement
  popupElement.appendChild(actionsDiv);

  // Add resize handles
  const resizeHandleLeft = document.createElement('div');
  resizeHandleLeft.className = 'resize-handle-left';
  popupElement.appendChild(resizeHandleLeft);

  const resizeHandleTop = document.createElement('div');
  resizeHandleTop.className = 'resize-handle-top';
  popupElement.appendChild(resizeHandleTop);

  const resizeHandleCorner = document.createElement('div');
  resizeHandleCorner.className = 'resize-handle-corner';
  popupElement.appendChild(resizeHandleCorner);

  // Add resize functionality
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

  resizeHandleLeft.addEventListener('mousedown', (e) => startResize(e, 'left'));
  resizeHandleTop.addEventListener('mousedown', (e) => startResize(e, 'top'));
  resizeHandleCorner.addEventListener('mousedown', (e) => startResize(e, 'corner'));

  function handleResize(e) {
    if (!isResizing) return;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const styles = getComputedStyle(popupElement);
    const minWidth = parseInt(styles.getPropertyValue('--min-width'));
    const maxWidth = parseInt(styles.getPropertyValue('--max-width'));
    const minHeight = parseInt(styles.getPropertyValue('--min-height'));
    const maxHeight = parseInt(styles.getPropertyValue('--max-height'));
    const viewportWidth = window.innerWidth;

    switch (currentHandle) {
        case 'left':
            const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth - deltaX));
            // Update width and right position instead of left
            popupElement.style.width = `${newWidth}px`;
            popupElement.style.right = `${viewportWidth - (startLeft + startWidth)}px`;
            popupElement.style.left = ''; // Clear left position
            break;
        case 'top':
            const newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight - deltaY));
            popupElement.style.height = `${newHeight}px`;
            break;
        case 'corner':
            const cornerWidth = Math.min(maxWidth, Math.max(minWidth, startWidth - deltaX));
            const cornerHeight = Math.min(maxHeight, Math.max(minHeight, startHeight - deltaY));
            popupElement.style.width = `${cornerWidth}px`;
            popupElement.style.height = `${cornerHeight}px`;
            popupElement.style.right = `${viewportWidth - (startLeft + startWidth)}px`;
            popupElement.style.left = ''; // Clear left position
            break;
    }
  }

  function stopResize() {
    isResizing = false;
    currentHandle = null;
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
    popupElement.classList.remove('resizing');
    savePopupPreferences();
  }

  document.body.appendChild(popupElement);

  

  // Drag functionality
  titleDiv.addEventListener('mousedown', (e) => {
    if (e.target === pinIcon) return; // Don't initiate drag when clicking pin
    
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    
    // Get the current position relative to viewport
    const rect = popupElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Store initial right/bottom positions
    popupStartRight = viewportWidth - rect.right;
    popupStartBottom = viewportHeight - rect.bottom;
    
    e.preventDefault();
  });

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  function onMouseMove(e) {
    if (isDragging) {
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      
      // Update right/bottom positioning
      const newRight = popupStartRight - deltaX;
      const newBottom = popupStartBottom - deltaY;
      
      // Maintain right/bottom positioning
      popupElement.style.right = `${newRight}px`;
      popupElement.style.bottom = `${newBottom}px`;
      popupElement.style.top = '';
      popupElement.style.left = '';
    }
  }

  function onMouseUp(e) {
    if (isDragging) {
      isDragging = false;
    }
  }

  // Close popup when clicking outside
  document.addEventListener('mousedown', onDocumentClick);

  function onDocumentClick(event) {
    // If clicking on the popup or dragging, do nothing
    if (popupElement.contains(event.target) || isDragging) {
      return;
    }
    if (!isPinned) {
      hidePopup();  // Use hidePopup instead of direct removal
    }
  }

  // Add to existing code
  function savePopupPreferences() {
    const contentDiv = popupElement.querySelector('.content');
    // Only save preferences if this is a new summary (not a saved note)
    if (contentDiv && !contentDiv.innerHTML) {
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
  }

  // Load preferences when showing popup
  function loadPopupPreferences() {
    chrome.storage.local.get('popupPrefs', (data) => {
      if (data.popupPrefs) {
        // Apply size first
        popupElement.style.width = `${data.popupPrefs.size.width}px`;
        popupElement.style.height = `${data.popupPrefs.size.height}px`;
        
        // Apply right/bottom positioning
        if (data.popupPrefs.position.right !== undefined) {
          popupElement.style.right = `${data.popupPrefs.position.right}px`;
          popupElement.style.bottom = `${data.popupPrefs.position.bottom}px`;
          // Clear any left/top positioning
          popupElement.style.left = '';
          popupElement.style.top = '';
        } else {
          // Default positioning if no right/bottom values
          popupElement.style.right = '20px';
          popupElement.style.bottom = '20px';
        }
      }
    });
  }

  // Add smooth title updates
  function updateTitle(newTitle) {
    const titleText = popupElement.querySelector('.title-text');
    titleText.classList.add('loading');
    setTimeout(() => {
        titleText.textContent = newTitle;
        titleText.classList.remove('loading');
    }, 300);
  }

  // Add loading state for copy button
  copyButton.addEventListener('click', () => {
    const originalText = copyButton.textContent;
    copyButton.style.width = copyButton.offsetWidth + 'px'; // Prevent width change
    copyButton.textContent = '...';
    
    navigator.clipboard.writeText(plainText).then(() => {
        copyButton.textContent = '✓ Copied!';
        setTimeout(() => {
            copyButton.textContent = originalText;
            copyButton.style.width = '';
        }, 2000);
    }).catch(err => {
        copyButton.textContent = '✗ Error';
        setTimeout(() => {
            copyButton.textContent = originalText;
            copyButton.style.width = '';
        }, 2000);
    });
  });

  // Smooth time saved updates
  function updateTimeSavedDisplay(timeSaved) {
    const timeSavedElement = popupElement.querySelector('.time-saved');
    timeSavedElement.classList.add('updating');
    setTimeout(() => {
        timeSavedElement.textContent = `Saved ${timeSaved} minutes`;
        timeSavedElement.classList.remove('updating');
    }, 300);
  }


  // Add this near the top of content.js with other listeners
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'showSavedNote') {
      console.log('Showing saved note:', message.note);
      
      // Make sure we're passing the URL correctly
      showPopup(
        message.note.content,
        message.note.title,
        message.note.timeSavedText,
        message.note.url  // This should be the actual URL from the saved note
      );
      
      sendResponse({ success: true });
      return true; // Keep the message channel open for the async response
    }
  });
}
