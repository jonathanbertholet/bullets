// content.js

console.log('Content script loaded.');

// Inject CSS styles into the page
const style = document.createElement('style');
style.textContent = `
/* Popup container */
.popup {
    position: absolute;
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

.popup::before {
    content: '';
    position: absolute;
    top: -10px;
    left: 30px; /* Adjust to align the arrow */
    border-left: 10px solid transparent;
    border-right: 10px solid transparent;
    border-bottom: 10px solid #ffffff;
    z-index: 999;
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
    font-size: 16px;
    font-weight: bold;
    margin-bottom: 8px;
    position: sticky;
    top: 0;
    z-index: 1;
    padding-bottom: 5px;
    color: #339133;
}

.content {
    white-space: pre-wrap;
    overflow-y: auto;
    flex: 1;
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

let lastSummarizedText = '';
let lastSummary = '';
let popupElement;
let mouseX = 800;
let mouseY = 800;

// Listen for context menu events to capture mouse coordinates
document.addEventListener('contextmenu', (event) => {
  console.log('Context menu event detected.');
  mouseX = event.pageX;
  mouseY = event.pageY;
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received in content script:', request);
  if (request.action === 'summarizePage') {
    console.log('Summarizing page...');
    let pageText = document.body.innerText;
    summarizeText(pageText);
  } else if (request.action === 'summarizeSelection') {
    console.log('Summarizing selection...');
    let selectedText = window.getSelection().toString();
    summarizeText(selectedText);
  }
});

// Function to summarize text
function summarizeText(text) {
  console.log('Summarize text called.');
  // Show loading popup
  showPopup('Bulleting in progress');

  // Send text to background script
  chrome.runtime.sendMessage({ action: 'callOpenAI', text: text }, (response) => {
    console.log('Received response from background script:', response);
    if (response && response.summary) {
      lastSummary = response.summary;
      // Update popup with summary
      showPopup(response.summary);
    } else if (response.error) {
      console.error(response.error);
      showPopup(`Error: ${response.error}`);
    } else {
      showPopup('An unexpected error occurred.');
    }
  });
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
  popupElement.style.top = (mouseY + 10) + 'px';
  popupElement.style.left = (mouseX + 10) + 'px';

  // Create title div
  const titleDiv = document.createElement('div');
  titleDiv.className = 'popup-title';
  titleDiv.textContent = 'Bullet';

  popupElement.appendChild(titleDiv);

  // Create content container
  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';

  // Set the textContent to display plaintext
  contentDiv.textContent = text;

  popupElement.appendChild(contentDiv);

  // Add the actions section with "Copy" button
  // Create actions container
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'popup-actions';

  // Create copy button
  const copyButton = document.createElement('button');
  copyButton.textContent = 'Copy';
  copyButton.className = 'copy-button';

  // Add click event listener to copy the summary text
  copyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(text).then(() => {
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

  // Adjust position if popup goes off-screen
  requestAnimationFrame(() => {
    const popupRect = popupElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Adjust if the popup goes beyond the right edge
    if (popupRect.right > viewportWidth) {
      const newLeft = viewportWidth - popupRect.width - 20; // 20px margin
      popupElement.style.left = newLeft + 'px';
    }

    // Adjust if the popup goes beyond the bottom edge
    if (popupRect.bottom > viewportHeight) {
      const newTop = viewportHeight - popupRect.height - 20; // 20px margin
      popupElement.style.top = newTop + 'px';
    }
  });

  // Close popup when clicking outside
  document.addEventListener('mousedown', function onDocumentClick(event) {
    if (!popupElement.contains(event.target)) {
      popupElement.remove();
      document.removeEventListener('mousedown', onDocumentClick);
    }
  });
}
