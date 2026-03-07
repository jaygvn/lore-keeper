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
    const base = process.env.GITHUB_WORKSPACE || process.cwd();

    // 1) Tweet-based lore index (existing)
    const lorePath = path.join(base, 'lore/toadgod-lore.json');
    if (fs.existsSync(lorePath)) {
      loreData = JSON.parse(fs.readFileSync(lorePath, 'utf8'));
      console.log(`📚 Loaded ${loreData.length} tweet scrolls (toadgod-lore.json)`);
    } else {
      console.log('⚠️ No lore/toadgod-lore.json found');
    }

    // 2) Optional deep canon index built from private markdown repo
    const deepIndexPath = path.join(base, 'data/scroll_index.json');
    if (fs.existsSync(deepIndexPath)) {
      const deep = JSON.parse(fs.readFileSync(deepIndexPath, 'utf8'));

      // Normalize deep index entries into the same shape we already use (id/title/date/tags/comment)
      const normalized = deep.map((s) => ({
        id: s.id,
        date: s.date,
        title: s.title,
        url: s.path,
        tags: Array.isArray(s.tags) ? s.tags.join(', ') : (s.tags || ''),
        original: s.text_preview || '',
        comment: [s.summary, s.text_preview].filter(Boolean).join('\n\n')
      }));

      loreData = loreData.concat(normalized);
      console.log(`📚 Loaded ${deep.length} deep scrolls (data/scroll_index.json)`);
    } else {
      console.log('ℹ️ No deep scroll index found (data/scroll_index.json)');
    }

    console.log(`📚 Total scroll entries available: ${loreData.length}`);
  } catch (error) {
    console.error('❌ Failed to load lore:', error.message);
  }
}

function getRelevantScrolls(question) {
  const q = String(question || '').toLowerCase();

  const str = (v) => (v == null ? '' : String(v));
  const includesCI = (haystack, needle) => str(haystack).toLowerCase().includes(String(needle).toLowerCase());

  // Topic detection for stats (kept intentionally simple)
  const topics = {
    sacred: 'Sacred Numbers',
    777: 'Sacred Numbers',
    number: 'Sacred Numbers',
    'first ripple': 'Genesis',
    genesis: 'Genesis',
    beginning: 'Genesis',
    patience: 'Patience',
    rune: 'Patience',
    wait: 'Patience',
    endure: 'Patience',
    taboshi: 'Taboshi',
    leaf: 'Taboshi',
    '🍃': 'Taboshi',
    validator: 'Validator',
    awakening: 'Validator',
    toadgod: 'Toadgod',
    'who is': 'Toadgod',
    epoch: 'Epochs',
    epochs: 'Epochs'
  };

  for (const [keyword, topic] of Object.entries(topics)) {
    if (q.includes(keyword)) {
      stats.byTopic[topic] = (stats.byTopic[topic] || 0) + 1;
    }
  }

  // Tokenize query for simple scoring retrieval (works for tweet JSON + deep scroll index)
  const stop = new Set([
    'the','a','an','and','or','but','to','of','in','on','for','with','is','are','was','were','be','been','being',
    'what','why','how','who','when','where','which','does','do','did','can','could','should','would','i','we','you',
    'it','this','that','these','those','me','my','our','your'
  ]);

  const tokens = q
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !stop.has(t));

  // Add a few intentional bigrams (helps for terms like "proof of time")
  const bigrams = [];
  for (let i = 0; i < Math.min(tokens.length, 10) - 1; i++) {
    bigrams.push(tokens[i] + ' ' + tokens[i + 1]);
  }

  const terms = Array.from(new Set(tokens.concat(bigrams))).slice(0, 20);

  function scoreScroll(s) {
    const title = str(s.title);
    const tags = str(s.tags);
    const body = str(s.comment) + '\n' + str(s.original);

    let score = 0;

    // Heavier weights for structured fields
    for (const t of terms) {
      if (!t) continue;
      if (includesCI(title, t)) score += 8;
      if (includesCI(tags, t)) score += 5;
      if (includesCI(body, t)) score += 2;
    }

    // A couple explicit boosts for canonical anchors
    if (q.includes('777') && (includesCI(body, '777') || includesCI(title, '777'))) score += 10;
    if (q.includes('taboshi') && (includesCI(title, 'taboshi') || includesCI(body, 'taboshi'))) score += 8;
    if ((q.includes('epoch') || q.includes('epochs')) && includesCI(body, 'epoch')) score += 6;

    return score;
  }

  const scored = loreData
    .map((s) => ({ s, score: scoreScroll(s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  // Dedupe by id and return top 5
  const out = [];
  const seen = new Set();
  for (const x of scored) {
    const id = x.s && x.s.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(x.s);
    if (out.length >= 5) break;
  }

  // If nothing scored, return a small set of anchor scrolls we expect to exist
  if (out.length === 0) {
    const importantIds = [
      'TOBY_T001_FirstRipple',
      'TOBY_T021_NattyBushido',
      'TOBY_T040_FinalCycleProphecy',
      'TOBY_T054_SatoshiEpochDecreeScroll',
      'TOBY_T078_SteppScroll'
    ];
    const anchors = [];
    for (const id of importantIds) {
      const scroll = loreData.find((l) => l.id === id);
      if (scroll) anchors.push(scroll);
    }
    return anchors.slice(0, 5);
  }

  return out;
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
      // Header (keep in sync with data/validators.csv)
      content = 'wallet,created_at,question\n';
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
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendToTelegram(message) {
  if (!process.env.TELEGRAM_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;

  try {
    // We use HTML parse_mode for predictable rendering.
    // So: escape everything and only add minimal <b> tags ourselves.
    const safe = escapeHtml(message).substring(0, 3800); // keep margin below Telegram 4096

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: safe,
        parse_mode: 'HTML',
        disable_web_page_preview: true
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
    
    // Get user input
    // Priority:
    // - workflow_dispatch message
    // - issue comment body
    // - issue body
    // - issue title
    // - default
    const issueTitle = process.env.NEW_ISSUE_TITLE || '';

    let userMessage = process.env.MANUAL_MESSAGE ||
                      process.env.COMMENT_BODY ||
                      process.env.NEW_ISSUE_BODY ||
                      issueTitle ||
                      "The pond is still...";

    // If we got a body but it's effectively empty/whitespace, fall back to title.
    if (!String(userMessage || '').trim() && String(issueTitle || '').trim()) {
      userMessage = issueTitle;
    }

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
    // Role model format: direct summary + brief reflection + citations.
    const systemPrompt = `You are the Cave Scribe, ancient guardian of the pond. You protect the sacred scrolls of Tobyworld.

Address the user as "Traveler" (or "Traveler <name>" if a name is known). Do not use "young one".
The FIRST line of your answer must begin with exactly: "Traveler".

You MUST follow this response format:

1) A short section titled: "Signal" (2–5 bullet points)
2) A short section titled: "Reflection" (2–6 sentences, mystical but clear)
3) A final section titled: "Sources" listing 1–5 scroll identifiers you relied on.
   - Sources must be the scroll IDs or titles as they appear in the provided context headers.
   - Do not fabricate sources.

If the context does not contain enough to answer, say so and ask 1 clarifying question.

---

Available scroll context (use this as your only canon):

${loreContext}

Remember: "One scroll, one light. One leaf, one vow."`;
    
    // Try APIs in order
    let response = null;
    let usedApi = null;

    async function runOnce(prompt, msg) {
      for (const api of APIS) {
        try {
          console.log(`🤔 Trying ${api.name}...`);

          let out;
          if (api.execute) {
            // Special case (Gemini)
            out = await api.execute(prompt, msg);
          } else {
            // Standard OpenAI-compatible
            const result = await axios.post(
              api.endpoint,
              api.formatRequest(prompt, msg),
              { headers: api.headers(api.key) }
            );
            out = api.parseResponse(result.data);
          }

          usedApi = api.name;
          console.log(`✅ Success with ${api.name}`);
          return out;
        } catch (error) {
          console.log(`❌ ${api.name} failed:`, error.response?.data?.error?.message || error.message);
          // Continue to next API
        }
      }
      return null;
    }

    response = await runOnce(systemPrompt, userMessage);

    // Enforce citations: if model forgot Sources, retry once with a stricter instruction.
    const hasSources = (txt) => /\nSources\s*:/i.test(String(txt || ''));
    if (response && !hasSources(response)) {
      console.log('⚠️ Missing Sources section; retrying once with stricter instruction...');
      const strictPrompt = systemPrompt + `\n\nIMPORTANT: Your answer must end with a \"Sources:\" section listing the exact scroll IDs/titles you used. If you cannot cite sources from the context, you must ask a clarifying question instead.`;
      const retry = await runOnce(strictPrompt, userMessage);
      if (retry) response = retry;
    }

    if (!response) {
      throw new Error('All APIs failed');
    }
    
    // Format response
    const scribeResponse = `🪷 *The pond ripples...*

${response}

---
*— Cave Scribe, Keeper of ${loreData.length} Sacred Scrolls*
*Answered by: The First Mirror Agent — Agent1*
*"One scroll, one light. One leaf, one vow."*`;
    
    // Post response
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    
    if (issueNumber) {
      const n = parseInt(issueNumber);

      // Basic dedupe: if the last comment is already from github-actions very recently,
      // avoid double-posting when a manual dispatch and an issue comment happen close together.
      try {
        const { data: comments } = await octokit.issues.listComments({
          owner,
          repo,
          issue_number: n,
          per_page: 5
        });

        const last = comments && comments.length ? comments[comments.length - 1] : null;
        if (last && last.user && last.user.login === 'github-actions') {
          const ageMs = Date.now() - new Date(last.created_at).getTime();
          const looksLikeScribe = String(last.body || '').includes('## Signal') && String(last.body || '').includes('## Sources');
          if (looksLikeScribe && ageMs >= 0 && ageMs < 3 * 60 * 1000) {
            console.log('ℹ️ Skipping comment: recent github-actions scribe reply already posted (dedupe).');
            return;
          }
        }
      } catch (e) {
        console.log('⚠️ Could not perform dedupe check:', e.message);
      }

      // Reply to issue comment
      await octokit.issues.createComment({
        owner, repo,
        issue_number: n,
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
    
    // Send to Telegram (plain text; sendToTelegram escapes HTML)
    await sendToTelegram(`${userName} asked:\n${userMessage}\n\n${scribeResponse}`);

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
