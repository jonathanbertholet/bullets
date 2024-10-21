console.log('Content script loaded.');

// Inject CSS styles into the page
const style = document.createElement('style');
style.textContent = `
/* Popup container */
.popup {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 400px;
    max-height: 500px;
    background: #ffffff;
    padding: 15px;
    border-radius: 10px;
    box-shadow: 0 5px 15px rgba(0,0,0,0.3);
    z-index: 2147483647;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 14px;
    color: #333;
    line-height: 1.5;
    opacity: 0;
    animation: fadeIn 0.3s forwards;
    display: flex;
    flex-direction: column;
}

@keyframes fadeIn {
    to {
        opacity: 1;
        transform: translateY(0);
    }
    from {
        opacity: 0;
        transform: translateY(-10px);
    }
}

.popup-title {
    display: flex;
    align-items: center;
    font-size: 16px;
    font-weight: bold;
    margin-bottom: 8px;
    position: sticky;
    top: 0;
    z-index: 1;
    padding-bottom: 5px;
    color: #339133;
    cursor: move;
    user-select: none;
}

.popup-title span {
    opacity: 1;
    transition: opacity 0.5s;
}

.popup-icon {
    width: 24px;
    height: 24px;
    margin-right: 8px;
}

.content {
    white-space: pre-wrap;
    overflow-y: auto;
    flex: 1;
}

.content span {
    opacity: 0;
    transition: opacity 0.9s;
}

.popup-actions {
    margin-top: 10px;
    display: flex;
    justify-content: flex-start;
}

.copy-button {
    background-color: #339133;
    color: #fff;
    border: none;
    padding: 8px 12px;
    font-size: 14px;
    border-radius: 5px;
    cursor: pointer;
}

.copy-button:hover {
    background-color: #2b7a2b; /* Darker green on hover */
}
`;
document.head.appendChild(style);

let popupElement;

// Variable to accumulate the streaming content
let accumulatedContent = '';

// Variables for drag functionality
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let popupStartX = 0;
let popupStartY = 0;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received in content script:', request);
  if (request.action === 'summarizePage') {
    console.log('Summarizing page...');
    let pageText = getCleanedPageText();
    summarizeText(pageText);
  } else if (request.action === 'summarizeSelection') {
    console.log('Summarizing selection...');
    let selectedText = window.getSelection().toString();
    summarizeText(selectedText);
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

// Function to summarize text
function summarizeText(text) {
  console.log('Summarize text called.');
  // Show loading popup
  showPopup('');

  // Reset accumulated content
  accumulatedContent = '';

  // Open a port to the background script
  const port = chrome.runtime.connect({ name: 'openai' });

  // Send the text over the port
  port.postMessage({ action: 'callOpenAI', text: text });

  // Listen for messages from the background script
  port.onMessage.addListener(function(msg) {
    if (msg.type === 'data') {
      // Update popup with streaming data
      updatePopup(msg.content);
    } else if (msg.type === 'error') {
      console.error(msg.error);
      showPopup(`Error: ${msg.error}`);
    } else if (msg.type === 'done') {
      // Generate a new AI-based title
      generateTitle(accumulatedContent);
      // Close the port when done
      port.disconnect();
    }
  });
}

// Function to generate title using AI
function generateTitle(summary) {
  console.log('Generating title.');
  // Open a port to the background script
  const port = chrome.runtime.connect({ name: 'openai' });

  // Send the action and summary over the port
  port.postMessage({ action: 'generateTitle', summary: summary });

  // Listen for messages from the background script
  port.onMessage.addListener(function(msg) {
    if (msg.type === 'title') {
      // Update the title with the generated title
      if (popupElement) {
        const titleTextSpan = popupElement.querySelector('.popup-title span');
        // Fade out the placeholder title
        titleTextSpan.style.opacity = 0;
        // After fade-out, update the text and fade in
        setTimeout(() => {
          titleTextSpan.textContent = msg.title;
          titleTextSpan.style.opacity = 1;
        }, 500); // match the transition duration
      }
      port.disconnect();
    } else if (msg.type === 'error') {
      console.error(msg.error);
      if (popupElement) {
        const titleTextSpan = popupElement.querySelector('.popup-title span');
        titleTextSpan.textContent = 'Error generating title';
      }
      port.disconnect();
    }
  });
}

// Function to update the popup with streaming data
function updatePopup(newText) {
  console.log('Updating popup.');
  if (popupElement) {
    const contentDiv = popupElement.querySelector('.content');
    // Create a new span element for the new text
    const span = document.createElement('span');
    span.textContent = newText;
    // Append the span to contentDiv
    contentDiv.appendChild(span);
    // Force reflow
    span.offsetWidth;
    // Apply fade-in effect
    span.style.opacity = 1;

    // Accumulate the content for later processing
    accumulatedContent += newText;
  }
}

// Function to show popup
function showPopup(text) {
  console.log('Showing popup.');
  // Remove existing popup if any
  if (popupElement) {
    popupElement.remove();
  }

  // Create popup element
  popupElement = document.createElement('div');
  popupElement.className = 'popup';

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
  titleTextSpan.textContent = 'Bullets';
  titleDiv.appendChild(titleTextSpan);

  popupElement.appendChild(titleDiv);

  // Create content container
  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';

  // Append contentDiv to popup
  popupElement.appendChild(contentDiv);

  // Add the actions section with "Copy" button
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'popup-actions';

  const copyButton = document.createElement('button');
  copyButton.textContent = 'Copy';
  copyButton.className = 'copy-button';

  copyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(contentDiv.textContent).then(() => {
      // Show feedback that it was copied
      copyButton.textContent = 'Copied!';
      setTimeout(() => {
        copyButton.textContent = 'Copy';
      }, 2000);
    }).catch(err => {
      console.error('Could not copy text: ', err);
    });
  });

  // Append copyButton to actionsDiv
  actionsDiv.appendChild(copyButton);

  // Append actionsDiv to popupElement
  popupElement.appendChild(actionsDiv);

  document.body.appendChild(popupElement);

  // Drag functionality
  titleDiv.addEventListener('mousedown', (e) => {
    isDragging = true;
    // Get the initial mouse position
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    
    // Get the current position of the popup
    const rect = popupElement.getBoundingClientRect();
    popupStartX = rect.left;
    popupStartY = rect.top;
    
    // Change positioning to top and left
    popupElement.style.bottom = '';
    popupElement.style.right = '';
    popupElement.style.top = popupStartY + 'px';
    popupElement.style.left = popupStartX + 'px';

    // Prevent text selection
    e.preventDefault();
  });

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  function onMouseMove(e) {
    if (isDragging) {
      // Calculate the new position
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      const newLeft = popupStartX + deltaX;
      const newTop = popupStartY + deltaY;
      
      // Set the new position
      popupElement.style.left = newLeft + 'px';
      popupElement.style.top = newTop + 'px';
    }
  }

  function onMouseUp(e) {
    if (isDragging) {
      isDragging = false;
    }
  }

  // Close popup when clicking outside
  document.addEventListener('mousedown', function onDocumentClick(event) {
    // If clicking on the popup or dragging, do nothing
    if (popupElement.contains(event.target) || isDragging) {
      return;
    }
    popupElement.remove();
    document.removeEventListener('mousedown', onDocumentClick);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  });
}
