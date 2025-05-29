require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const OpenAI = require('openai');

// Store your OpenAI API key here (or use dotenv for production)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Middleware to verify Memberstack token
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const response = await axios.get('https://api.memberstack.io/v1/members/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Memberstack-Key': process.env.MEMBERSTACK_SECRET_KEY
      }
    });
    req.member = response.data;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

app.post('/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
      timeout: 10000,
    });
    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article || !article.textContent || !article.textContent.trim()) {
      console.warn('Extraction failed or content empty for URL:', url);
      return res.status(500).json({ error: 'Failed to extract main content from the URL.' });
    }
    res.json({
      title: article.title,
      content: article.textContent,
      html: article.content
    });
  } catch (err) {
    console.error('Error in /extract:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to extract content', details: err.message });
  }
});

// Generate 5 tool ideas
app.post('/ideas', async (req, res) => {
  const { content } = req.body;
  try {
    // Log the content being sent to OpenAI
    console.log('OpenAI /ideas prompt content:', content.slice(0, 500));
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are an expert at creating interactive web tools for blog content. Given a blog post, suggest 5 highly relevant and engaging interactive tool ideas that would add value for readers. Each idea must:
1. Be directly relevant to the blog post's main topic and key points
2. Provide clear, measurable value to readers
3. Be technically feasible to implement
4. Be engaging and interactive
5. Have a clear purpose and user flow
6. Be unique and innovative
7. Be suitable for embedding in a blog post

Respond with a numbered list of 5 short, clear tool ideas. Do not include explanations or markdown.`
        },
        {
          role: "user",
          content: `Suggest 5 interactive tool ideas for this blog post: ${content}`
        }
      ],
    });
    const text = completion.choices[0].message.content || '';
    const ideas = text
      .split(/\n+/)
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);
    res.json({ ideas });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate tool ideas', details: err.message });
  }
});

// Add validation function
function validateGeneratedTool(tool) {
  const issues = [];
  
  // Check for basic structure
  if (!tool.includes('<html') || !tool.includes('</html>')) {
    issues.push('Missing HTML structure');
  }
  
  // Check for accessibility
  if (!tool.includes('aria-')) {
    issues.push('Missing ARIA attributes for accessibility');
  }
  
  // Check for responsive design
  if (!tool.includes('@media') && !tool.includes('width: 100%')) {
    issues.push('Missing responsive design elements');
  }
  
  // Check for error handling
  if (!tool.includes('try') && !tool.includes('catch')) {
    issues.push('Missing error handling');
  }
  
  // Check for input validation
  if (tool.includes('<input') && !tool.includes('required') && !tool.includes('validate')) {
    issues.push('Missing input validation');
  }
  
  // Check for loading states
  if (tool.includes('fetch') && !tool.includes('loading')) {
    issues.push('Missing loading states for async operations');
  }
  
  // Check for color contrast
  const lowContrastColors = [
    'color: #f0f0f0',
    'color: #e0e0e0',
    'color: #d0d0d0',
    'background: #f0f0f0',
    'background: #e0e0e0',
    'background: #d0d0d0'
  ];
  if (lowContrastColors.some(color => tool.includes(color))) {
    issues.push('Potential low contrast color combinations detected');
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}

// Update the generate endpoint to include validation
app.post('/generate', async (req, res) => {
  const { content, idea, userRequirements } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are an expert at creating highly engaging, modern, and interactive web tools for blog content. Given a blog post and user requirements, generate a sophisticated, ultra-engaging tool that is directly relevant to the post's topic and provides real value to readers.

Quality Requirements:
1. Content Relevance:
   - Use terminology, examples, and scenarios directly from the blog post
   - Ensure all content is accurate and aligned with the source material
   - Maintain consistent tone and style with the original content

2. User Experience:
   - Create a clear, intuitive user flow
   - Provide immediate feedback for user actions
   - Include helpful error messages and validation
   - Ensure smooth transitions and animations
   - Implement proper loading states

3. Technical Quality:
   - Write clean, well-structured code
   - Implement proper error handling
   - Ensure cross-browser compatibility
   - Optimize performance (minimize DOM operations, use efficient algorithms)
   - Follow best practices for HTML, CSS, and JavaScript

4. Visual Design:
   - Use a modern, professional design
   - Implement proper spacing and typography
   - Ensure visual hierarchy guides user attention
   - Use appropriate color contrast (WCAG AA compliant)
   - Make the tool responsive and mobile-friendly

5. Accessibility:
   - Include proper ARIA labels
   - Ensure keyboard navigation works
   - Maintain sufficient color contrast
   - Provide text alternatives for visual elements
   - Support screen readers

6. Security:
   - Sanitize all user inputs
   - Prevent XSS vulnerabilities
   - Handle sensitive data appropriately
   - Implement proper validation

Output a complete, embeddable widget with HTML, CSS, and JS. Do not include markdown, triple backticks, or explanations—just the raw HTML, CSS, and JS.`
        },
        {
          role: "user",
          content: `Blog content: ${content}\n\nUser requirements: ${userRequirements || idea || ''}`
        }
      ],
    });
    
    const generatedTool = completion.choices[0].message.content || '';
    const validation = validateGeneratedTool(generatedTool);
    
    if (!validation.isValid) {
      // If validation fails, try to regenerate with specific feedback
      const retryCompletion = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          {
            role: "system",
            content: `You are an expert at creating highly engaging, modern, and interactive web tools for blog content. Given a blog post and user requirements, generate a sophisticated, ultra-engaging tool that is directly relevant to the post's topic and provides real value to readers.

Quality Requirements:
1. Content Relevance:
   - Use terminology, examples, and scenarios directly from the blog post
   - Ensure all content is accurate and aligned with the source material
   - Maintain consistent tone and style with the original content

2. User Experience:
   - Create a clear, intuitive user flow
   - Provide immediate feedback for user actions
   - Include helpful error messages and validation
   - Ensure smooth transitions and animations
   - Implement proper loading states

3. Technical Quality:
   - Write clean, well-structured code
   - Implement proper error handling
   - Ensure cross-browser compatibility
   - Optimize performance (minimize DOM operations, use efficient algorithms)
   - Follow best practices for HTML, CSS, and JavaScript

4. Visual Design:
   - Use a modern, professional design
   - Implement proper spacing and typography
   - Ensure visual hierarchy guides user attention
   - Use appropriate color contrast (WCAG AA compliant)
   - Make the tool responsive and mobile-friendly

5. Accessibility:
   - Include proper ARIA labels
   - Ensure keyboard navigation works
   - Maintain sufficient color contrast
   - Provide text alternatives for visual elements
   - Support screen readers

6. Security:
   - Sanitize all user inputs
   - Prevent XSS vulnerabilities
   - Handle sensitive data appropriately
   - Implement proper validation

Output a complete, embeddable widget with HTML, CSS, and JS. Do not include markdown, triple backticks, or explanations—just the raw HTML, CSS, and JS.

Please address these quality issues in the generated tool:\n${validation.issues.join('\n')}`
          },
          {
            role: "user",
            content: `Blog content: ${content}\n\nUser requirements: ${userRequirements || idea || ''}`
          }
        ],
      });
      
      const retryTool = retryCompletion.choices[0].message.content || '';
      const retryValidation = validateGeneratedTool(retryTool);
      
      if (retryValidation.isValid) {
        res.json({ tool: retryTool });
      } else {
        res.json({ 
          tool: retryTool,
          warnings: retryValidation.issues
        });
      }
    } else {
      res.json({ tool: generatedTool });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate tool', details: err.message });
  }
});

// Update a tool with user feedback
app.post('/update', async (req, res) => {
  const { content, currentTool, feedback, conversationHistory = [] } = req.body;
  try {
    const messages = [
      {
        role: "system",
        content: `You are an expert at updating interactive tools for blog content. You maintain a conversation history with the user to understand their requirements better. Here is the original blog post: ${content}. Here is the current tool code: ${currentTool}. The user wants the following changes: ${feedback}. Please update the tool accordingly, taking into account the conversation history to provide a more contextual and helpful response. Return only the updated, complete HTML+JS code, no explanations or markdown. Output a complete, embeddable widget with HTML, CSS, and JS. Do not output only JavaScript or code blocks.`
      }
    ];

    // Add conversation history to the messages
    conversationHistory.forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });

    // Add the current feedback
    messages.push({
      role: "user",
      content: feedback
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: messages,
    });

    const updatedTool = completion.choices[0].message.content || '';
    
    // Add the assistant's response to the conversation history
    const updatedHistory = [
      ...conversationHistory,
      { role: "user", content: feedback },
      { role: "assistant", content: "I've updated the tool based on your feedback." }
    ];

    res.json({ 
      tool: updatedTool,
      conversationHistory: updatedHistory
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tool', details: err.message });
  }
});

// Update /publish endpoint to include user ID
app.post('/publish', verifyToken, async (req, res) => {
  const { filename, html } = req.body;
  if (!filename || !html) return res.status(400).json({ error: 'Missing filename or html' });

  const repo = 'sodapork/interactive-tools';
  const branch = 'gh-pages';
  const path = filename.endsWith('.html') ? filename : `${filename}.html`;
  const githubToken = process.env.GITHUB_TOKEN;
  const userId = req.member.id;

  console.log('Publishing tool:', {
    filename,
    path,
    userId,
    tokenLength: githubToken ? githubToken.length : 0
  });

  // Get the current file SHA if it exists (for updates)
  let sha = undefined;
  try {
    console.log('Checking if file exists:', `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`);
    const getResp = await axios.get(
      `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
      { headers: { Authorization: `token ${githubToken}` } }
    );
    sha = getResp.data.sha;
    console.log('File exists, got SHA:', sha);
  } catch (e) {
    console.log('File does not exist yet, will create new:', e.message);
    // File does not exist, that's fine
  }

  // Create or update the file
  try {
    console.log('Attempting to create/update file...');
    const response = await axios.put(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        message: `Publish tool: ${path}`,
        content: Buffer.from(html).toString('base64'),
        branch,
        ...(sha ? { sha } : {})
      },
      { headers: { Authorization: `token ${githubToken}` } }
    );
    console.log('File created/updated successfully:', response.data);

    // Store tool metadata in a separate file
    const metadataPath = `metadata/${userId}/${path}.json`;
    const metadata = {
      userId,
      filename: path,
      url: `https://sodapork.github.io/interactive-tools/${path}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      console.log('Storing metadata...');
      const metadataResponse = await axios.put(
        `https://api.github.com/repos/${repo}/contents/${metadataPath}`,
        {
          message: `Update tool metadata: ${path}`,
          content: Buffer.from(JSON.stringify(metadata, null, 2)).toString('base64'),
          branch
        },
        { headers: { Authorization: `token ${githubToken}` } }
      );
      console.log('Metadata stored successfully:', metadataResponse.data);
    } catch (err) {
      console.error('Error storing metadata:', err.response ? err.response.data : err.message);
    }

    res.json({ url: metadata.url, tool: html });
  } catch (err) {
    console.error('Error in /publish:', {
      message: err.message,
      response: err.response ? err.response.data : null,
      status: err.response ? err.response.status : null,
      headers: err.response ? err.response.headers : null
    });
    res.status(500).json({ 
      error: 'Failed to publish tool', 
      details: err.message,
      response: err.response ? err.response.data : null
    });
  }
});

// Update /recent endpoint to only return user's tools
app.get('/recent', verifyToken, async (req, res) => {
  const repo = 'sodapork/interactive-tools';
  const branch = 'gh-pages';
  const githubToken = process.env.GITHUB_TOKEN;
  const userId = req.member.id;

  try {
    // Get all metadata files for the user
    const response = await axios.get(
      `https://api.github.com/repos/${repo}/contents/metadata/${userId}?ref=${branch}`,
      githubToken
        ? { headers: { Authorization: `token ${githubToken}` } }
        : undefined
    );

    const tools = await Promise.all(
      response.data.map(async (file) => {
        const metadataResponse = await axios.get(
          file.download_url,
          githubToken
            ? { headers: { Authorization: `token ${githubToken}` } }
            : undefined
        );
        return metadataResponse.data;
      })
    );

    res.json({ tools: tools.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
  } catch (err) {
    console.error('Error in /recent:', err.response ? err.response.data : err.message, err.stack);
    res.status(500).json({ error: 'Failed to fetch recent tools', details: err.message });
  }
});

// Add after /recent endpoint
app.get('/my-tools', verifyToken, async (req, res) => {
  const repo = 'sodapork/interactive-tools';
  const branch = 'gh-pages';
  const githubToken = process.env.GITHUB_TOKEN;
  const userId = req.member.id;

  try {
    const response = await axios.get(
      `https://api.github.com/repos/${repo}/contents/metadata/${userId}?ref=${branch}`,
      githubToken
        ? { headers: { Authorization: `token ${githubToken}` } }
        : undefined
    );

    const tools = await Promise.all(
      response.data.map(async (file) => {
        const metadataResponse = await axios.get(
          file.download_url,
          githubToken
            ? { headers: { Authorization: `token ${githubToken}` } }
            : undefined
        );
        return metadataResponse.data;
      })
    );

    res.json({ tools: tools.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.json({ tools: [] });
    }
    console.error('Error in /my-tools:', err.response ? err.response.data : err.message, err.stack);
    res.status(500).json({ error: 'Failed to fetch user tools', details: err.message });
  }
});

const PORT = 5001;
app.listen(PORT, () => {
  console.log(`Content extraction server running on port ${PORT}`);
}); 