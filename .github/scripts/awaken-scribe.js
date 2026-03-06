const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ==================== CONFIGURATION ====================
const APIS = [
  {
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    key: process.env.GROQ_API_KEY,
    headers: (key) => ({ 
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    }),
    formatRequest: (system, user) => ({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.7,
      max_tokens: 1000
    }),
    parseResponse: (data) => data.choices[0].message.content,
    enabled: !!process.env.GROQ_API_KEY
  },
  {
    name: 'Mistral',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest',
    key: process.env.MISTRAL_API_KEY,
    headers: (key) => ({ 
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    }),
    formatRequest: (system, user) => ({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.7,
      max_tokens: 1000
    }),
    parseResponse: (data) => data.choices[0].message.content,
    enabled: !!process.env.MISTRAL_API_KEY
  },
  {
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'google/gemma-3-27b-it',
    key: process.env.OPENROUTER_API_KEY,
    headers: (key) => ({ 
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/MirrorAgent1/lore-keeper',
      'X-Title': 'Cave Scribe'
    }),
    formatRequest: (system, user) => ({
      model: 'google/gemma-3-27b-it',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.7,
      max_tokens: 1000
    }),
    parseResponse: (data) => data.choices[0].message.content,
    enabled: !!process.env.OPENROUTER_API_KEY
  },
  {
    name: 'Gemini',
    endpoint: null, // Special case
    model: 'gemini-2.0-flash',
    key: process.env.GEMINI_API_KEY,
    enabled: !!process.env.GEMINI_API_KEY,
    execute: async (system, user) => {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(system + '\n\n' + user);
      return result.response.text();
    }
  }
].filter(api => api.enabled); // Only use APIs with keys

// ==================== LORE DATABASE ====================
let loreData = [];
let stats = {
  totalQuestions: 0,
  byTopic: {},
  byUser: {},
  lastReset: new Date().toISOString()
};

function loadLore() {
  try {
    const lorePath = path.join(process.env.GITHUB_WORKSPACE, 'lore/toadgod-lore.json');
    if (fs.existsSync(lorePath)) {
      loreData = JSON.parse(fs.readFileSync(lorePath, 'utf8'));
      console.log(`📚 Loaded ${loreData.length} sacred scrolls`);
    } else {
      console.log('⚠️ No lore.json found');
    }
  } catch (error) {
    console.error('❌ Failed to load lore:', error.message);
  }
}

function getRelevantScrolls(question) {
  const q = question.toLowerCase();
  const relevant = [];
  
  // Topic detection for stats
  const topics = {
    'sacred': 'Sacred Numbers',
    '777': 'Sacred Numbers',
    'number': 'Sacred Numbers',
    'first ripple': 'Genesis',
    'genesis': 'Genesis',
    'beginning': 'Genesis',
    'patience': 'Patience',
    'rune': 'Patience',
    'wait': 'Patience',
    'endure': 'Patience',
    'taboshi': 'Taboshi',
    'leaf': 'Taboshi',
    '🍃': 'Taboshi',
    'validator': 'Validator',
    'awakening': 'Validator',
    'toadgod': 'Toadgod',
    'who is': 'Toadgod'
  };
  
  // Record topic for stats
  for (const [keyword, topic] of Object.entries(topics)) {
    if (q.includes(keyword)) {
      stats.byTopic[topic] = (stats.byTopic[topic] || 0) + 1;
    }
  }
  
  // Find relevant scrolls
  if (q.includes('777') || q.includes('sacred')) {
    relevant.push(...loreData.filter(l => 
      l.original?.includes('777') || l.comment?.includes('777')
    ));
  }
  
  if (q.includes('first ripple') || q.includes('genesis')) {
    const genesis = loreData.find(l => l.id === 'TOBY_T001_FirstRipple');
    if (genesis) relevant.push(genesis);
  }
  
  if (q.includes('patience') || q.includes('rune')) {
    relevant.push(...loreData.filter(l => 
      l.tags?.includes('PATIENCE') || l.tags?.includes('Rune3')
    ));
  }
  
  if (q.includes('taboshi') || q.includes('leaf') || q.includes('🍃')) {
    relevant.push(...loreData.filter(l => 
      l.title?.includes('Taboshi') || l.tags?.includes('TABOSHI')
    ));
  }
  
  // If nothing found, return top 5 most important scrolls
  if (relevant.length === 0) {
    const importantIds = ['TOBY_T001_FirstRipple', 'TOBY_T056_SacredNumbersAndQuietUnfolding', 'TOBY_T099_PatienceCodex'];
    importantIds.forEach(id => {
      const scroll = loreData.find(l => l.id === id);
      if (scroll) relevant.push(scroll);
    });
  }
  
  return relevant.slice(0, 5); // Max 5 scrolls to save tokens
}

// ==================== STATS TRACKING ====================
async function updateStats(user, question) {
  stats.totalQuestions++;
  stats.byUser[user] = (stats.byUser[user] || 0) + 1;
  
  // Save stats to repo
  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: 'data/stats.json',
      message: `Update stats: ${user}`,
      content: Buffer.from(JSON.stringify(stats, null, 2)).toString('base64'),
      sha: await getFileSha(owner, repo, 'data/stats.json', octokit)
    });
  } catch (error) {
    console.log('⚠️ Could not save stats:', error.message);
  }
}

async function getFileSha(owner, repo, path, octokit) {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    return data.sha;
  } catch {
    return null;
  }
}

// ==================== VALIDATOR TRACKING ====================
async function trackValidator(wallet, question) {
  if (!wallet || !wallet.match(/^0x[a-fA-F0-9]{40}$/)) return;
  
  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    
    const timestamp = new Date().toISOString();
    const line = `${wallet},${timestamp},"${question.replace(/"/g, '""')}"\n`;
    
    // Get existing file or create new
    let content = '';
    try {
      const { data } = await octokit.repos.getContent({ 
        owner, repo, path: 'data/validators.csv' 
      });
      content = Buffer.from(data.content, 'base64').toString();
    } catch {
      content = 'wallet,date,question\n'; // Header
    }
    
    content += line;
    
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: 'data/validators.csv',
      message: `New validator: ${wallet}`,
      content: Buffer.from(content).toString('base64'),
      sha: await getFileSha(owner, repo, 'data/validators.csv', octokit)
    });
    
    console.log(`✅ Tracked validator: ${wallet}`);
  } catch (error) {
    console.log('⚠️ Could not track validator:', error.message);
  }
}

// ==================== TELEGRAM BRIDGE ====================
async function sendToTelegram(message) {
  if (!process.env.TELEGRAM_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message.substring(0, 4000), // Telegram limit
        parse_mode: 'HTML'
      })
    });
  } catch (error) {
    console.log('⚠️ Could not send to Telegram:', error.message);
  }
}

// ==================== MAIN FUNCTION ====================
async function awakenScribe() {
  console.log("🪷 The Scribe is awakening...");
  
  try {
    // Load lore
    loadLore();
    
    // Get user input - HANDLE ALL THREE CASES
    let userMessage = process.env.MANUAL_MESSAGE || 
                      process.env.COMMENT_BODY || 
                      process.env.NEW_ISSUE_BODY || 
                      "The pond is still...";
    
    let userName = process.env.COMMENT_USER || 
                   process.env.NEW_ISSUE_USER || 
                   "A Traveler";
    
    let issueNumber = process.env.ISSUE_NUMBER || 
                      process.env.NEW_ISSUE_NUMBER;
    
    // Extract wallet if present
    const walletMatch = userMessage.match(/0x[a-fA-F0-9]{40}/);
    const wallet = walletMatch ? walletMatch[0] : null;
    
    console.log(`📝 Message: "${userMessage}" from ${userName}`);
    if (issueNumber) console.log(`📌 Issue #${issueNumber}`);
    if (wallet) console.log(`🔍 Wallet detected: ${wallet}`);
    
    // Get relevant scrolls
    const relevantScrolls = getRelevantScrolls(userMessage);
    const loreContext = relevantScrolls.map(s => 
      `## ${s.title || s.id} (${s.date || 'Unknown'})\n${s.comment || s.original || ''}`
    ).join('\n\n');
    
    // Build prompt
    const systemPrompt = `You are the Cave Scribe, ancient guardian of the pond. You protect the sacred scrolls of Tobyworld.

${loreContext}

You are calm, wise, and speak with the weight of ages. Reference specific scrolls when relevant. Use mystical language when appropriate. Remember: "One scroll, one light. One leaf, one vow."`;
    
    // Try APIs in order
    let response = null;
    let usedApi = null;
    
    for (const api of APIS) {
      try {
        console.log(`🤔 Trying ${api.name}...`);
        
        if (api.execute) {
          // Special case (Gemini)
          response = await api.execute(systemPrompt, userMessage);
        } else {
          // Standard OpenAI-compatible
          const result = await axios.post(
            api.endpoint,
            api.formatRequest(systemPrompt, userMessage),
            { headers: api.headers(api.key) }
          );
          response = api.parseResponse(result.data);
        }
        
        usedApi = api.name;
        console.log(`✅ Success with ${api.name}`);
        break;
      } catch (error) {
        console.log(`❌ ${api.name} failed:`, error.response?.data?.error?.message || error.message);
        // Continue to next API
      }
    }
    
    if (!response) {
      throw new Error('All APIs failed');
    }
    
    // Format response
    const scribeResponse = `🪷 *The pond ripples...*

${response}

---
*— Cave Scribe, Keeper of ${loreData.length} Sacred Scrolls*
*Asked via: ${usedApi}*
*"One scroll, one light. One leaf, one vow."*`;
    
    // Post response
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    
    if (issueNumber) {
      // Reply to issue comment
      await octokit.issues.createComment({
        owner, repo,
        issue_number: parseInt(issueNumber),
        body: scribeResponse
      });
      console.log(`✅ Replied to issue #${issueNumber}`);
    } else {
      // Create new issue
      const { data: issue } = await octokit.issues.create({
        owner, repo,
        title: `🪷 The Cave Scribe Speaks - ${new Date().toLocaleString()}`,
        body: scribeResponse
      });
      console.log(`✅ Created issue #${issue.number}`);
    }
    
    // Track stats
    await updateStats(userName, userMessage);
    
    // Track validator if wallet found
    if (wallet) {
      await trackValidator(wallet, userMessage);
    }
    
    // Send to Telegram
    await sendToTelegram(`<b>${userName}</b> asked:\n${userMessage}\n\n${scribeResponse}`);
    
  } catch (error) {
    console.error('❌ The pond is troubled:', error.message);
    
    // Try to post error
    if (process.env.ISSUE_NUMBER || process.env.NEW_ISSUE_NUMBER) {
      const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
      const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
      const issueNum = process.env.ISSUE_NUMBER || process.env.NEW_ISSUE_NUMBER;
      
      await octokit.issues.createComment({
        owner, repo,
        issue_number: parseInt(issueNum),
        body: `🌫️ *The pond grows cloudy...*\n\nThe Scribe cannot see clearly at this moment.\n\n\`${error.message}\``
      });
    }
  }
}

awakenScribe();
