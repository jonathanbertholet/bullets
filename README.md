# Bullets
Summarizes any Chrome page into a few succinct bullet points to gain a quick understanding of a page's contents.

# Bullet Extension
Bullet is a Chrome extension that allows you to quickly summarize web pages or selected text into concise bullet points. It integrates seamlessly into your browsing experience, providing easy access through the context menu and toolbar.

## Features
- **Summarize Entire Pages**: Right-click on any page and select "Bullet page" to get a bullet-point summary of the entire content.
- **Summarize Selected Text**: Highlight any text, right-click, and choose "Bullet selection" to summarize just that portion.
- **Copy Summaries**: Easily copy the generated summaries to your clipboard with a single click.
- **Customizable API Key**: Use your own OpenAI API key for personalized and secure access.

# Setting Up Your OpenAI API Key

1. **Obtain an API Key**: Sign up at OpenAI and generate an API key.
2. **Add Your API Key to the Extension**:
   - Click on the Bullet extension icon in the Chrome toolbar.
   - Enter your API key in the provided field.
   - Click Save API Key.

## Generating Summaries
### Summarize an Entire Page:
- Right-click anywhere on the page without selecting text.
- Choose Bullet page from the context menu.

### Summarize Selected Text:
- Highlight the text you wish to summarize.
- Right-click and select Bullet selection from the context menu.

## Copying Summaries
- After generating a summary, a popup will appear with the bullet points.
- Click the Copy button at the bottom of the popup to copy the summary to your clipboard.

### Privacy and Data Usage
- **User Data**: The extension does not collect or store any personal data from users.
- **API Key Storage**: Your OpenAI API key is stored locally using Chrome's secure `chrome.storage.sync` API.
- **Data Transmission**: Text content for summarization is sent to OpenAI's API servers securely over HTTPS. Please refer to the Privacy Policy section for more details.

# Contributing
Contributions are welcome! Please open an issue or submit a pull request on GitHub.

# License
This project is licensed under the MIT License.

# Privacy Policy
**Effective Date**: 20/10/2024

Your privacy is important to us. This Privacy Policy explains how the Bullet Extension ("we", "us", or "our") collects, uses, and discloses information when you use our Chrome extension ("the Extension").

## Information We Collect

### User-Provided Information
- **OpenAI API Key**: When you provide your OpenAI API key in the Extension's settings, it is stored locally on your device using Chrome's `chrome.storage.sync` API. This allows the Extension to access the OpenAI API on your behalf.

### Automatically Collected Information
- **Text Content**: When you use the summarization feature, the selected text or entire page content is sent to OpenAI's API for processing.

## How We Use Your Information
- **Summarization**: The text content you choose to summarize is sent to OpenAI's API to generate bullet-point summaries.
- **API Key Usage**: Your OpenAI API key is used solely to authenticate requests to the OpenAI API.

## Data Storage and Security
- **Local Storage**: Your API key is stored locally on your device using Chrome's secure storage mechanisms.
- **Data Transmission**: All data transmitted to OpenAI's API is sent over secure HTTPS connections.

## Disclosure of Your Information
- **Third-Party Services**: The Extension interacts with the OpenAI API to provide summarization services. OpenAI's use of your data is governed by their own Privacy Policy.
- **No Sale of Data**: We do not sell, trade, or rent your personal information to others.

## Your Choices
- **Providing Information**: You may choose not to provide your OpenAI API key; however, the summarization features will be unavailable without it.
- **Access and Deletion**: You can delete your API key at any time by removing it from the Extension's settings.

## Children's Privacy
The Extension is not intended for use by individuals under the age of 13. We do not knowingly collect personal information from children under 13.

## Changes to This Privacy Policy
We may update our Privacy Policy from time to time. Changes will be posted within the Extension and are effective immediately upon posting.

# Contact Us
If you have any questions about this Privacy Policy, please contact us at:

- **Email**: youremail@example.com
- **GitHub**: [https://github.com/yourusername/bullet-extension](https://github.com/yourusername/bullet-extension)

By using the Bullet Extension, you agree to the collection and use of information in accordance with this Privacy Policy.
