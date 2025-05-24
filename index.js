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
app.use(cors({
  origin: [
    'https://interactive-content-frontend.vercel.app',
    'http://localhost:3000'
  ],
  credentials: true
}));
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
          content: `You are an expert at creating interactive web tools for blog content. Given a blog post, suggest 5 highly relevant and engaging interactive tool ideas (such as calculators, quizzes, checklists, or comparison charts) that would add value for readers. Respond with a numbered list of 5 short, clear tool ideas. Do not include explanations or markdown.`
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

// Generate a tool for a selected idea
app.post('/generate', async (req, res) => {
  const { content, idea, userRequirements } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are an expert at creating highly engaging, modern, and interactive web tools for blog content. Given a blog post and user requirements, generate a sophisticated, ultra-engaging tool that is directly relevant to the post's topic and provides real value to readers.\n\nRequirements:\n- The tool should be more than a simple calculator or checklist; it should include advanced interactivity, dynamic feedback, and multiple steps or features if appropriate.\n- Make the tool visually appealing, modern, and professional.\n- Ensure the tool is highly relevant to the provided blog content and tailored to the target audience.\n- Use creative elements: animations, progress bars, charts, branching logic, or gamification if it fits the context.\n- Use a super clean, modern, black and white style with Inter font, proper spacing, and no color except for clear focus/active states.\n- Output a complete, embeddable widget with HTML, CSS, and JS. Do not output only JavaScript or code blocks. Do not include markdown, triple backticks, or explanations—just the raw HTML, CSS, and JS.`
        },
        {
          role: "user",
          content: `Blog content: ${content}\n\nUser requirements: ${userRequirements || idea || ''}`
        }
      ],
    });
    res.json({ tool: completion.choices[0].message.content || '' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate tool', details: err.message });
  }
});

// Update a tool with user feedback
app.post('/update', async (req, res) => {
  const { content, currentTool, feedback } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are an expert at updating interactive tools for blog content. Here is the original blog post: ${content}. Here is the current tool code: ${currentTool}. The user wants the following changes: ${feedback}. Please update the tool accordingly. Return only the updated, complete HTML+JS code, no explanations or markdown. Output a complete, embeddable widget with HTML, CSS, and JS. Do not output only JavaScript or code blocks.`
        }
      ],
    });
    res.json({ tool: completion.choices[0].message.content || '' });
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

  // Get the current file SHA if it exists (for updates)
  let sha = undefined;
  try {
    const getResp = await axios.get(
      `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
      { headers: { Authorization: `token ${githubToken}` } }
    );
    sha = getResp.data.sha;
  } catch (e) {
    // File does not exist, that's fine
  }

  // Create or update the file
  try {
    await axios.put(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        message: `Publish tool: ${path}`,
        content: Buffer.from(html).toString('base64'),
        branch,
        ...(sha ? { sha } : {})
      },
      { headers: { Authorization: `token ${githubToken}` } }
    );

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
      await axios.put(
        `https://api.github.com/repos/${repo}/contents/${metadataPath}`,
        {
          message: `Update tool metadata: ${path}`,
          content: Buffer.from(JSON.stringify(metadata, null, 2)).toString('base64'),
          branch
        },
        { headers: { Authorization: `token ${githubToken}` } }
      );
    } catch (err) {
      console.error('Error storing metadata:', err);
    }

    res.json({ url: metadata.url });
  } catch (err) {
    console.error('Error in /publish:', err.response ? err.response.data : err.message, err.stack);
    res.status(500).json({ error: 'Failed to publish tool', details: err.message });
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

const PORT = 5001;
app.listen(PORT, () => {
  console.log(`Content extraction server running on port ${PORT}`);
}); 